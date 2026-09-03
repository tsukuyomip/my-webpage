import type { Shot } from './types'

/**
 * セリフから表情を推す。
 *
 * ## なぜ絵ではなく文字なのか
 *
 * 顔の絵から表情を測ろうとして、**測って落とした**。実機 118 顔で、目・口の窓を
 * 詰めた勾配（HOG）を何通り試しても、平均 AUC は 0.53〜0.58 ── 表情が見えない
 * はずの「色だけ」の記述子（0.579）を超えられなかった。強く見えた組は裏を取ると
 * キャラ識別だった（ジト目 0.83 → ことねを抜くと 0.59）。詳しくは
 * docs/shot-bank-plan.md。
 *
 * **セリフのほうが遥かに効く。** 同じ枚を本文で測ると:
 *
 *     タグ    枚数   絵(最良)   セリフ   キャラを入れ替えても
 *     笑      55    0.55      0.82    0.72  ← 残る
 *     喜      21    0.54      0.71    0.75  ← 残る
 *     ドヤ顔   18    0.50      0.76    0.72  ← 残る
 *     怒      16    0.68*     0.72    0.70  ← 残る（*絵のほうはキャラ由来）
 *     照れ     30    0.57      0.61    0.41  ← 口調だった。残らない
 *     真顔     19    0.70      0.55    0.38  ← 残らない
 *
 * 「キャラを入れ替えても」は、学習に出てこなかった人で試した値。ここが崩れる
 * ものは、表情ではなく**その人の口調**を覚えていたということ。
 *
 * ## 作り
 *
 * **文字の 1 つ・2 つ並びの「出現の有無」でナイーブベイズ。** 日本語を単語に
 * 割らないのは、この規模（100 枚台）では割らないほうが素直に効くため。
 * 回数ではなく有無にしているのは、「ばかああああ」の 1 枚が回数で全体を
 * 支配するのを避けるため（実測でも有無のほうが良かった: 怒 0.66 → 0.72）。
 *
 * **学習はこの端末の中だけ。** 手で振ったタグがそのまま教師になる。配る重みは
 * 無い ── 顔の見本と違って、セリフの言い回しは人によって偏るので、配っても
 * 当たらない（上の表で「残らない」ものがまさにそれ）。
 *
 * **推した札は教師にしない。** 顔のときと同じ ── 推したものを見本にすると、
 * 外れが外れを呼ぶ。
 */

/** 学習した中身。1 タグにつき 1 つ作る。 */
export interface MoodModel {
  tag: string
  /** そのタグを持つ枚で、この特徴が出た回数 */
  pos: Map<string, number>
  neg: Map<string, number>
  nPos: number
  nNeg: number
  vocab: number
  /**
   * これを超えたら「たぶんこの表情」と出す線。
   *
   * **タグごとに、この端末の実績から決める。** 「笑」は 4 枚に 3 枚当たるが、
   * 「真顔」は 5 枚に 1 枚しか当たらない（実測）。同じ線で扱うと、当たらない
   * タグが一覧を汚す。1 つ抜きで測って、狙った適合率に届く線を探す。
   * 届かないタグは Infinity ＝ **何も出さない**。
   */
  threshold: number
  /** その線での実績（画面に出して、信じるかどうかを決めてもらう） */
  precision: number
  recall: number
}

/** 文字 1 つと 2 つ並びの集合。出た・出ないだけを見る。 */
export function features(text: string): Set<string> {
  const t = text.trim()
  const f = new Set<string>()
  for (const ch of t) f.add(ch)
  for (let i = 0; i + 1 < t.length; i++) f.add(t.slice(i, i + 2))
  return f
}

/** 1 枚から、推しに使う文字列を取り出す。本文と話者名の両方を見る。 */
export function textOf(shot: Shot): string {
  return `${shot.body ?? ''} ${shot.speakerRaw ?? ''}`.trim()
}

const ALPHA = 0.3

function scoreWith(
  f: Set<string>,
  pos: Map<string, number>,
  neg: Map<string, number>,
  nPos: number,
  nNeg: number,
  vocab: number,
): number {
  if (!nPos || !nNeg) return -Infinity
  let s = Math.log((nPos + 1) / (nPos + nNeg + 2)) - Math.log((nNeg + 1) / (nPos + nNeg + 2))
  // 出現の有無なので、その特徴を持つ枚数 ÷ 全枚数 が確率になる。
  const dPos = nPos + ALPHA * vocab
  const dNeg = nNeg + ALPHA * vocab
  for (const k of f) {
    s += Math.log(((pos.get(k) ?? 0) + ALPHA) / dPos)
    s -= Math.log(((neg.get(k) ?? 0) + ALPHA) / dNeg)
  }
  return s
}

/** 学習に使う 1 件。 */
export interface Example {
  features: Set<string>
  moods: string[]
}

export function toExamples(shots: Shot[]): Example[] {
  const out: Example[] = []
  for (const s of shots) {
    // **手で振ったものだけを教師にする。** 推した札（moodsGuessed）は入れない。
    if (!s.moods?.length) continue
    const t = textOf(s)
    if (!t) continue
    out.push({ features: features(t), moods: s.moods })
  }
  return out
}

/**
 * 1 タグぶんを学習する。
 *
 * 線は 1 つ抜きで探す ── 自分自身を教師から外して点数を出し、狙った適合率に
 * 届く中でいちばん多く拾える線を採る。**届かなければ Infinity**（出さない）。
 */
export function trainTag(examples: Example[], tag: string, minPrecision: number): MoodModel | null {
  const pos = new Map<string, number>()
  const neg = new Map<string, number>()
  const vocabSet = new Set<string>()
  let nPos = 0
  let nNeg = 0
  for (const e of examples) {
    const has = e.moods.includes(tag)
    const bag = has ? pos : neg
    if (has) nPos++
    else nNeg++
    for (const k of e.features) {
      bag.set(k, (bag.get(k) ?? 0) + 1)
      vocabSet.add(k)
    }
  }
  // 教師が薄すぎると、線を測ること自体が当てにならない。
  if (nPos < 6 || nNeg < 6) return null
  const vocab = vocabSet.size || 1

  // 1 つ抜きの点数。自分の寄与を引いてから測り、すぐ戻す。
  // 数え上げを複製しないのは速さのため ── 枚数 × タグ数ぶん複製すると、
  // 枚数が増えたときにタグを 1 つ押すたびの待ちになる（語彙は数千ある）。
  const scored = examples.map((e) => {
    const has = e.moods.includes(tag)
    const bag = has ? pos : neg
    for (const k of e.features) bag.set(k, bag.get(k)! - 1)
    const score = scoreWith(
      e.features,
      pos,
      neg,
      nPos - (has ? 1 : 0),
      nNeg - (has ? 0 : 1),
      vocab,
    )
    for (const k of e.features) bag.set(k, bag.get(k)! + 1)
    return { has, score }
  })

  scored.sort((a, b) => b.score - a.score)
  let hit = 0
  let best: { threshold: number; precision: number; recall: number } | null = null
  for (let i = 0; i < scored.length; i++) {
    if (scored[i]!.has) hit++
    const precision = hit / (i + 1)
    const recall = hit / nPos
    // 狙いに届いていて、いちばん多く拾えるところ。**同点なら広いほうを採る**
    // （拾える枚数が増えるほど、探し物に当たる見込みが上がる）。
    if (precision >= minPrecision && (!best || recall > best.recall)) {
      best = { threshold: scored[i]!.score, precision, recall }
    }
  }
  if (!best) return null

  return { tag, pos, neg, nPos, nNeg, vocab, ...best }
}

/**
 * 手で振ってあるタグぜんぶについて、使えるものだけ学習する。
 *
 * 既定の 0.65 は実測で決めた。**探せることが第一で、多少の余計なヒットは許す**
 * という向きなので、適合率は低めに、再現率を高く採る側へ振ってある
 * （実機 117 枚での、狙い値ごとの「笑」の成績）:
 *
 *     狙い   適合   再現   推した総数
 *     0.50   53%   100%   144  ← 笑が付きすぎ。一覧が意味を失う
 *     0.60   60%    85%    89
 *     0.65   69%    80%    74  ← ここ
 *     0.70   74%    78%    69
 *     0.80   80%    58%    51  ← 半分近く取りこぼす
 */
export function trainMoods(shots: Shot[], minPrecision = 0.65): MoodModel[] {
  const examples = toExamples(shots)
  if (examples.length < 20) return []
  const tags = [...new Set(examples.flatMap((e) => e.moods))]
  return tags
    .map((t) => trainTag(examples, t, minPrecision))
    .filter((m): m is MoodModel => m !== null)
}

/** この 1 枚に、たぶん付く表情。手で振ってあるものは触らない。 */
export function guessMoods(shot: Shot, models: MoodModel[]): string[] {
  const t = textOf(shot)
  if (!t || !models.length) return []
  const f = features(t)
  const already = new Set(shot.moods ?? [])
  return models
    .filter((m) => !already.has(m.tag))
    .filter((m) => scoreWith(f, m.pos, m.neg, m.nPos, m.nNeg, m.vocab) >= m.threshold)
    .map((m) => m.tag)
}
