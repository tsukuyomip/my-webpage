import { newId } from './ids'
import { findByColor, findCharacter, normalizeName, withColorSample } from './names'
import type { Character, Shot } from './types'

/**
 * 名簿は OCR から育つ。分かっている名前は先に入れておく。
 *
 * 育つ仕組みは残す。読めた話者名が既存に近ければ寄せ、遠ければ新しい人として
 * 仮登録する。ゲーム側にキャラが増えても、アプリを直さずに追随できる。
 *
 * そのうえで、分かっている主要キャラは種として先に入れる（seedRoster）。
 * 種が無いと、1〜2 文字の名前は編集距離の許容が 0 なので、誤読のたびに
 * 別人が増えていた（実測: 「広」が「リム」と読まれて仮登録された）。
 * 種があれば、正しく読めた回に確実に当たり、誤読は名簿の画面で
 * その人に寄せられる（寄せた綴りは別名として残る）。
 */

/**
 * 分かっている名前を名簿に入れる。何度呼んでも同じ結果になる。
 *
 * すでに同じ名前（または別名）の人がいれば、増やさずにその人を「確かめ済み」にする。
 * 仮登録のまま育っていた人を、種と二重に持たないため。
 * 消した人が戻ってこないよう、呼ぶ側は 1 回だけ通すこと（Settings.rosterSeed）。
 */
export function seedRoster(
  roster: Character[],
  known: readonly { name: string; color?: string; samples?: readonly string[] }[],
): { roster: Character[]; added: Character[]; promoted: Character[] } {
  const next = [...roster]
  const added: Character[] = []
  const promoted: Character[] = []
  // 教わった並びを createdAt に写して、一覧の並びを決められるようにする。
  // 同じミリ秒に 20 人入れると、入れた順が残らない。
  const base = Date.now()
  let order = 0

  for (const { name, color, samples } of known) {
    const key = normalizeName(name)
    if (!key) continue
    const index = next.findIndex((c) =>
      [c.name, ...c.aliases].some((n) => normalizeName(n) === key),
    )
    if (index >= 0) {
      const found = next[index]
      // 色をまだ持っていない人には入れてやる。名前が一度も読めないキャラは
      // 自力では色を覚えられないので、ここが唯一の入り口になる。
      const needsColor = color !== undefined && found.color === undefined
      if (!found.provisional && !needsColor) continue
      const updated = {
        ...found,
        provisional: false,
        color: found.color ?? color,
        colorSamples: found.colorSamples ?? (samples ? [...samples] : undefined),
      }
      next[index] = updated
      promoted.push(updated)
      continue
    }
    const created: Character = {
      id: newId(),
      name,
      aliases: [],
      color,
      colorSamples: samples ? [...samples] : undefined,
      provisional: false,
      createdAt: base + order++,
    }
    next.push(created)
    added.push(created)
  }

  return { roster: next, added, promoted }
}

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

  /** 当たった人に紐付け、読めた綴りと色を覚えさせる。 */
  const attach = (shot: Shot, character: Character, raw: string) => {
    assignments.set(shot.id, character.id)
    // 読めた綴りが名簿に無い形なら、別名として覚えておく。次から確実に当たる。
    const known = new Set([character.name, ...character.aliases].map(normalizeName))
    if (!known.has(normalizeName(raw))) character.aliases = [...character.aliases, raw]
    // 見た色を覚える。すでに近い色を知っていれば増えない。
    const learned = withColorSample(character, shot.speakerChipColor)
    character.color = learned.color
    character.colorSamples = learned.colorSamples
  }

  // 1 周目: 名前で当てる。ここで色が貯まる。
  const newNames: Shot[] = []
  const unreadable: Shot[] = []
  for (const shot of shots) {
    // 手で決めたものは触らない。読み取りより人の判断のほうが確か。
    if (shot.speakerPicked) continue
    const raw = shot.speakerRaw?.trim()
    if (!raw) {
      unreadable.push(shot)
      continue
    }
    const match = findCharacter(next, raw, shot.speakerChipColor)
    if (match) attach(shot, match.character, raw)
    else newNames.push(shot)
  }

  // 2 周目: 名前は読めたが誰にも寄らなかったもの。新しい人として仮登録する。
  // ここを色に頼らせてはいけない。プロデューサー（2943）は無彩色なので、
  // 同じ無彩色の香名江に吸われた（実測）。読めた名前は、新しい人がいる証。
  //
  // ただし **この周で作った人にも当て直す**。ここを見落としていて、同じ「ことね」が
  // 枚数ぶん並んだ（実測: 84 枚から名簿が 40 人になり、全員 1 枚だった）。
  for (const shot of newNames) {
    const raw = shot.speakerRaw!.trim()
    const again = findCharacter(next, raw, shot.speakerChipColor)
    if (again) {
      attach(shot, again.character, raw)
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

  // 3 周目: 名前が読めなかったものを、色で当てる。
  // 名簿が出そろってから見るので、「近い人が 2 人いる」をきちんと弾ける。
  for (const shot of unreadable) {
    const byColor = findByColor(next, shot.speakerChipColor)
    if (byColor) assignments.set(shot.id, byColor.id)
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

/** 何枚で喋っているか。「喋っている」の絞り込みは、写っているだけの人を出さない。 */
export function countSpeakers(shots: Shot[]): Map<string, number> {
  const counts = new Map<string, number>()
  for (const shot of shots) {
    if (!shot.speakerId) continue
    counts.set(shot.speakerId, (counts.get(shot.speakerId) ?? 0) + 1)
  }
  return counts
}

/** 出てくる人だけを、よく出る順に。0 枚の人を出しても、押せば必ず 0 件になる。 */
export function byUse(roster: Character[], counts: Map<string, number>): Character[] {
  return roster
    .filter((c) => (counts.get(c.id) ?? 0) > 0)
    .sort((a, b) => (counts.get(b.id) ?? 0) - (counts.get(a.id) ?? 0))
}
