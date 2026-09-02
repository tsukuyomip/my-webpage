import { getAllCharacters, getImage, getThumb, putCharacter, putShot } from './db'
import { extensionFor } from './encode'
import { normalizeName } from './names'
import { stampNow } from './format'
import type { BackupManifest, Character, Shot } from './types'
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
  // **名簿も入れる。** スクショは人を id で指しているだけなので、名簿が無いと
  // 戻した先で誰も指さなくなる。名簿は入れ直しで別の id が振られるため、
  // 「同じ名前だから繋がる」ということも起きない。
  const characters = await getAllCharacters()
  const manifest: BackupManifest = { version: 2, exportedAt: Date.now(), shots, characters }
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
  /** 名簿に足した人数 */
  characters: number
  /** 名簿が入っていない古い形式（v1）だったか。人物の札が外れるので、呼ぶ側が断る */
  rosterMissing: boolean
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
  if (manifest.version !== 1 && manifest.version !== 2) {
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

  const result: RestoreResult = {
    added: 0,
    skipped: 0,
    missing: 0,
    characters: 0,
    rosterMissing: !manifest.characters,
  }

  // **名簿を先に戻す。** スクショより後だと、書いた直後の一瞬だけ
  // 誰も指していない状態ができる。
  //
  // 同じ人が別の id で既に居ることがある ── 全消しのあとは種が入れ直され、
  // 同じ 20 人に新しい id が振られる。そのまま足すと同じ名前が 2 つずつ並ぶ
  //（実測で 20 人 → 41 人）。**名前で引き当てて、控えの id を手元の id に読み替える。**
  // 手元の名前・色はそのまま（手で直したものを古い控えで潰さない）、
  // 控えが覚えていた別名だけ足す。
  const local = await getAllCharacters()
  const byId = new Set(local.map((c) => c.id))
  const byName = new Map<string, Character>()
  for (const c of local) for (const n of [c.name, ...c.aliases]) byName.set(normalizeName(n), c)

  /** 控えの id → 手元の id。読み替えの要らないものは入れない。 */
  const remap = new Map<string, string>()
  for (const character of manifest.characters ?? ([] as Character[])) {
    if (byId.has(character.id)) continue
    const found = [character.name, ...character.aliases]
      .map((n) => byName.get(normalizeName(n)))
      .find(Boolean)
    if (found) {
      remap.set(character.id, found.id)
      const known = new Set([found.name, ...found.aliases].map(normalizeName))
      const extra = [character.name, ...character.aliases].filter(
        (a) => !known.has(normalizeName(a)),
      )
      const colors = [...new Set([...(found.colorSamples ?? []), ...(character.colorSamples ?? [])])]
      if (extra.length || colors.length !== (found.colorSamples ?? []).length) {
        await putCharacter({ ...found, aliases: [...found.aliases, ...extra], colorSamples: colors })
      }
      continue
    }
    await putCharacter(character)
    byId.add(character.id)
    for (const n of [character.name, ...character.aliases]) byName.set(normalizeName(n), character)
    result.characters++
  }

  /** 控えの中の「誰か」を、手元の id に読み替える。 */
  const rewrite = (shot: Shot): Shot => {
    if (!remap.size) return shot
    const at = (id?: string) => (id ? (remap.get(id) ?? id) : id)
    return {
      ...shot,
      speakerId: at(shot.speakerId),
      characterIds: shot.characterIds && [...new Set(shot.characterIds.map((i) => at(i)!))],
      faces: shot.faces?.map((f) => ({ ...f, characterId: at(f.characterId) })),
    }
  }

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
      rewrite(shot),
      new Blob([image.blob], { type: shot.mime }),
      new Blob([thumb.blob], { type: mimeForExtension(thumb.ext) }),
    )
    result.added++
  }
  return result
}
