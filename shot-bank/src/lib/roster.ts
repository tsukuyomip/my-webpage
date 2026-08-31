import { newId } from './ids'
import { findCharacter, normalizeName } from './names'
import type { Character, Shot } from './types'

/**
 * 名簿は OCR から勝手に育つ。
 *
 * キャラ一覧をハードコードしない。読めた話者名が既存に近ければ寄せ、
 * 遠ければ新しい人として仮登録する。ゲーム側にキャラが増えても
 * アプリを直さずに追随できるし、他のゲームにも同じ仕組みが効く。
 */

export interface ResolveResult {
  roster: Character[]
  /** この呼び出しで新しく仮登録された人 */
  added: Character[]
  /** shot.id → 決まった characterId */
  assignments: Map<string, string>
}

/**
 * スクショの話者名を名簿へ寄せる。名簿に無ければ足す。
 *
 * 手で直した話者名（textEdited）も同じ経路を通す。
 * 直した名前こそ正しいので、それを名簿に反映したい。
 */
export function resolveSpeakers(shots: Shot[], roster: Character[]): ResolveResult {
  const next = [...roster]
  const added: Character[] = []
  const assignments = new Map<string, string>()

  for (const shot of shots) {
    const raw = shot.speakerRaw?.trim()
    if (!raw) continue
    const match = findCharacter(next, raw, shot.speakerChipColor)
    if (match) {
      assignments.set(shot.id, match.character.id)
      // 読めた綴りが名簿に無い形なら、別名として覚えておく。次から確実に当たる。
      const known = new Set(
        [match.character.name, ...match.character.aliases].map(normalizeName),
      )
      if (!known.has(normalizeName(raw))) match.character.aliases = [...match.character.aliases, raw]
      // 色をまだ持っていなければ、ここで覚える。
      if (!match.character.color && shot.speakerChipColor) {
        match.character.color = shot.speakerChipColor
      }
      continue
    }
    const created: Character = {
      id: newId(),
      name: raw,
      aliases: [],
      color: shot.speakerChipColor,
      provisional: true,
      createdAt: Date.now(),
    }
    next.push(created)
    added.push(created)
    assignments.set(shot.id, created.id)
  }

  return { roster: next, added, assignments }
}

/** 2 人を 1 人にまとめる。消えるほうの名前と別名は、残るほうの別名に移す。 */
export function mergeCharacters(
  roster: Character[],
  keepId: string,
  dropId: string,
): { roster: Character[]; keep: Character } | null {
  const keep = roster.find((c) => c.id === keepId)
  const drop = roster.find((c) => c.id === dropId)
  if (!keep || !drop || keepId === dropId) return null

  const known = new Set([keep.name, ...keep.aliases].map(normalizeName))
  const merged: Character = {
    ...keep,
    aliases: [
      ...keep.aliases,
      ...[drop.name, ...drop.aliases].filter((a) => !known.has(normalizeName(a))),
    ],
    color: keep.color ?? drop.color,
    provisional: keep.provisional && drop.provisional,
  }
  return {
    roster: roster.filter((c) => c.id !== dropId).map((c) => (c.id === keepId ? merged : c)),
    keep: merged,
  }
}

/** 何枚に出てくるか。名簿の画面で、よく出る順に並べるのに使う。 */
export function countByCharacter(shots: Shot[]): Map<string, number> {
  const counts = new Map<string, number>()
  const bump = (id: string) => counts.set(id, (counts.get(id) ?? 0) + 1)
  for (const shot of shots) {
    if (shot.speakerId) bump(shot.speakerId)
    for (const id of shot.characterIds ?? []) if (id !== shot.speakerId) bump(id)
  }
  return counts
}
