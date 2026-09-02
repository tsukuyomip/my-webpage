import { embedDistance } from './embed'
import type { Face, Shot } from './types'

/**
 * 名前の付いた顔から、名前の付いていない顔を当てる。
 *
 * **k 近傍。学習はしない。** 手で付けた名前がそのまま見本になり、確定するたびに
 * 強くなる。学習の要る仕組みは、いつ・何で学習し直すかを決める必要があるうえ、
 * 間違いを直しても効くまでに間が空く。近傍法ならその場で効く。
 *
 * **提案までにする。勝手に付けない。** 実測で、同じ人どうしの距離（0.09〜0.56）と
 * 別人どうしの距離（最小 0.24）は重なる。だから 1 本のしきい値では切り分けられない。
 * 「たぶんこの人」を出して、押してもらう。
 */

export interface Suggestion {
  characterId: string
  /** いちばん近い見本までの距離 */
  distance: number
  /**
   * 確からしさ 0〜1。
   * 2 番手（別の人）までの距離との開きで決める。近い人が 2 人いれば下がる。
   */
  confidence: number
  /** 見本が何枚あったか */
  samples: number
}

export interface Example {
  characterId: string
  embed: readonly number[]
}

/**
 * 見本を集める。
 *
 * **推しただけの顔（assigned === 'guess'）は入れない。**
 * 推したものを見本にすると、外れが外れを呼んで雪だるまになる。
 * 手で決めたものと、話者から決めたものだけを信じる。
 */
export function collectExamples(shots: Shot[], exclude?: string): Example[] {
  const out: Example[] = []
  for (const shot of shots) {
    for (const f of shot.faces ?? []) {
      if (f.id === exclude) continue
      if (f.assigned === 'guess') continue
      if (f.characterId && f.embed) out.push({ characterId: f.characterId, embed: f.embed })
    }
  }
  return out
}

/**
 * この顔は誰か、いちばんありそうな人を返す。
 *
 * 見本が 1 人ぶんしか無いときは、比べる相手がいないので確からしさを控えめにする
 * （どんな顔でもその 1 人がいちばん近くなるため）。
 */
export function suggestFace(face: Face, examples: Example[]): Suggestion | null {
  if (!face.embed || !examples.length) return null

  // 人ごとに、いちばん近い見本までの距離。
  const best = new Map<string, { d: number; n: number }>()
  for (const e of examples) {
    const d = embedDistance(face.embed, e.embed)
    const cur = best.get(e.characterId)
    if (!cur) best.set(e.characterId, { d, n: 1 })
    else {
      cur.n++
      if (d < cur.d) cur.d = d
    }
  }

  const ranked = [...best.entries()].sort((a, b) => a[1].d - b[1].d)
  const [id, top] = ranked[0]!
  const second = ranked[1]?.[1].d

  // 2 番手との開きで測る。開いているほど「この人だ」と言える。
  // 比べる相手がいなければ、距離そのものから控えめに出す。
  const confidence =
    second === undefined
      ? Math.max(0, Math.min(0.5, 1 - top.d / 0.9))
      : Math.max(0, Math.min(1, 1 - top.d / second))

  return { characterId: id, distance: top.d, confidence, samples: top.n }
}

/** 提案を出すかどうかの下限。これを下回るものは黙っている。 */
export const SUGGEST_MIN_CONFIDENCE = 0.15

/**
 * これを超えたら、押してもらわずに仮で付ける。
 *
 * 見本 17 個で 1 つ抜きの実測:
 *
 *     正解した提案の確信    0.350 〜 0.892
 *     外れた提案の確信      0.004 〜 0.477   ← その人の見本が無い場合
 *
 * **重なっている**ので、1 本の線で「正解だけ」は取れない。
 * 仮で付けるほうは外さないことを優先して 0.5 に置いた。実測でこの線なら
 * 外れは 1 つも入らず、正解 7 件のうち 4 件が拾える。
 * 残り（0.35〜0.49）は提案のまま出して、押してもらう。
 */
export const AUTO_CONFIDENCE = 0.5

/**
 * 名前の付いていない顔にだけ提案を付ける。
 *
 * 自分自身を見本から外す ── 入れると距離 0 で必ず自分を指し、
 * 「もう名前が付いている顔」に提案が出てしまう。
 */
export function suggestFor(
  shot: Shot,
  shots: Shot[],
): Map<string, Suggestion> {
  const out = new Map<string, Suggestion>()
  const faces = (shot.faces ?? []).filter((f) => !f.characterId && f.embed)
  if (!faces.length) return out
  const examples = collectExamples(shots)
  for (const f of faces) {
    const s = suggestFace(f, examples)
    if (s && s.confidence >= SUGGEST_MIN_CONFIDENCE) out.set(f.id, s)
  }
  return out
}

/**
 * 押してもらわなくても決まるぶんを、仮で付ける。
 *
 * **話者が読めていて顔が 1 つなら、その人。** 実機の感触で「大体合っている」。
 * これがいちばん効く ── 手を動かさずに見本が溜まり、そこから推せるようになる。
 * 顔が 2 つ以上あるときは、どちらが話者か分からないので何もしない。
 *
 * 似ている顔からの推測は、確信が AUTO_CONFIDENCE を超えたぶんだけ。
 * こちらは見本には使わない（collectExamples 参照）。
 *
 * すでに名前の付いている顔と、手が入った顔には触らない。
 * 手で外したものを付け直すと、「違う」と言ったものが戻ってきて、直す気が失せる。
 */
export function autoAssign(shots: Shot[]): Map<string, Face[]> {
  const changed = new Map<string, Face[]>()
  const examples = collectExamples(shots)

  for (const shot of shots) {
    const faces = shot.faces ?? []
    if (!faces.length) continue
    let touched = false
    const next = faces.map((f) => {
      if (f.characterId || f.namePicked) return f

      // 話者が読めていて、顔が 1 つ。
      if (shot.speakerId && faces.length === 1) {
        touched = true
        return { ...f, characterId: shot.speakerId, assigned: 'speaker' as const }
      }

      // 似ている顔から。確信が足りなければ触らない。
      const s = suggestFace(f, examples)
      if (s && s.confidence >= AUTO_CONFIDENCE) {
        touched = true
        return { ...f, characterId: s.characterId, assigned: 'guess' as const }
      }
      return f
    })
    if (touched) changed.set(shot.id, next)
  }
  return changed
}
