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
 * **セリフのほうが効く。** 同じ枚を本文で測ると（AUC・0.50 が偶然）:
 *
 *     タグ    枚数   絵(最良)   セリフ 1枚抜き   キャラを1人ずつ抜くと
 *     笑      55    0.55      0.79           0.65  ← 残る
 *     怒      16    0.68*     0.68           0.66  ← 残る（*絵のほうはキャラ由来）
 *     真顔     19    0.70      0.67           0.62  ← 残る
 *     喜      21    0.54      0.62           0.59
 *     困      30    —         0.61           0.51  ← 崩れる
 *     ドヤ顔   18    0.50      0.58           0.48  ← 崩れる
 *     ジト目   12    0.83*     0.55           0.46  ← 崩れる
 *     照れ     30    0.57      0.56           0.45  ← 崩れる
 *
 * **「キャラを 1 人ずつ抜くと」が本当の値。** 学習に出てこなかった人で試すので、
 * ここが崩れるものは表情ではなく**その人の口調**を覚えていたということ。
 *
 * 最初はキャラを複数まとめた 5 分割で測って、ドヤ顔 0.72・喜 0.75 と report した。
 * **甘かった** ── 1 人ずつ抜くと 0.48・0.59。同じ甘さが線の引き方にも入っていた
 * ので、そちらも直した（trainTag を参照）。
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
 *
 * ## 弱点（承知の上で入れている）
 *
 * **札は「写っている顔」に付くのに、セリフは「話者」のもの。** 別人が喋って
 * いる絵では原理的に外れる。`speakerShown` で「違うと分かったときだけ」止めて
 * いる。詳しくはそこのコメント。
 *
 * **黙っている顔には付かない。** セリフが無ければ何も出ない。絵からしか分から
 * ない「真顔」はここでは拾えない（絵からなら AUC 0.70 で拾えていた）。
 *
 * ## 絵から測る道具は、探したうえで使っていない
 *
 * face-api.js の表情モデル（MIT・329KB・npm 同梱なので自前で配れる）を、
 * 同じ 117 顔に当てて測った。**アニメ絵には効かない**:
 *
 *     切り出しの余白    笑↔happy   怒↔angry   真顔↔neutral   驚き↔surprised
 *     0%              0.573      0.740      0.442         0.743
 *     10%             0.565      0.601      0.348         0.713
 *     25%             0.568      0.580      0.387         0.591
 *     50%             0.492      0.424      0.449         0.858
 *
 * 笑は 53 枚あるのに happy が最上位になったのは 117 枚中 4 枚だけで、model は
 * 半数を sad と答えた（実写で学習しているので当然）。良く見える数字は切り出しを
 * 変えるたびに大きく振れる ＝ 信号ではない。
 *
 * 正しい道具はアニメ絵で学習したタガー（danbooru 系。smile / open_mouth /
 * half-closed_eyes / smirk など、欲しい札とほぼ一対一）だが、いちばん小さい
 * ものでも 40MB 台＋実行時 10MB で、いまの JS 264KB とは別の種類のアプリに
 * なる。**入れるなら、それを承知で選ぶ話。**
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

/**
 * 1 枚から、推しに使う文字列を取り出す。**本文だけ。話者名は入れない。**
 *
 * 入れていたが、測って外した ── 話者名だけで「笑」が 適65%/再82% 出てしまう。
 * それは表情ではなく「この人はよく笑う」を覚えているだけで、キャラを入れ替えると
 * 消える。実測（キャラを 1 人ずつ抜く分割）:
 *
 *     タグ    話者名あり   本文だけ
 *     笑      0.652      0.650   ← 変わらない
 *     困      0.470      0.508
 *     真顔     0.603      0.622
 *     ジト目    0.367      0.462
 *
 * **入れても入れなくてもキャラ分割の値は変わらない** ＝ 話者名が効いていたのは
 * 同じ人の中でだけ。抜いたほうが素直で、線も正しく引ける。
 */
export function textOf(shot: Shot): string {
  return (shot.body ?? '').trim()
}

/**
 * 「誰の絵か」。線を引くとき、**同じ人の別の枚を教師から外す**ために使う。
 *
 * 分からなければ null ＝ その枚だけを抜く（できることをする）。
 */
export function whoOf(shot: Shot): string | null {
  if (shot.speakerId) return shot.speakerId
  return (shot.faces ?? []).find((f) => f.characterId)?.characterId ?? null
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
  /** 誰の絵か。同じ人をまとめて教師から外すために持つ。null は「分からない」 */
  who: string | null
}

export function toExamples(shots: Shot[]): Example[] {
  const out: Example[] = []
  for (const s of shots) {
    // **手で振ったものだけを教師にする。** 推した札（moodsGuessed）は入れない。
    if (!s.moods?.length) continue
    const t = textOf(s)
    if (!t) continue
    out.push({ features: features(t), moods: s.moods, who: whoOf(s) })
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

  // **同じ人をまとめて抜いてから測る。**
  //
  // 1 枚だけ抜くと、同じ人の別の枚が教師に残る。すると「その人の口調」を覚えた
  // だけでも高く出て、線が甘くなる ── 実測で、ドヤ顔は 1 枚抜きなら 0.58 だが
  // その人を丸ごと抜くと 0.48（偶然以下）に落ちる。1 枚抜きで線を引いていた頃は、
  // その札を「適合率 100%」として出していた。
  //
  // 誰か分からない枚は、その 1 枚だけを抜く（できることをする）。
  const groups = new Map<string, number[]>()
  examples.forEach((e, i) => {
    const key = e.who ?? `#${i}`
    groups.set(key, [...(groups.get(key) ?? []), i])
  })

  // 数え上げは複製せず、群ぶんを引いて測って戻す（語彙は数千あるので複製は重い）。
  const scored = new Array<{ has: boolean; score: number }>(examples.length)
  for (const idx of groups.values()) {
    let dPos = 0
    let dNeg = 0
    for (const i of idx) {
      const e = examples[i]!
      const has = e.moods.includes(tag)
      const bag = has ? pos : neg
      for (const k of e.features) bag.set(k, bag.get(k)! - 1)
      if (has) dPos++
      else dNeg++
    }
    for (const i of idx) {
      const e = examples[i]!
      scored[i] = {
        has: e.moods.includes(tag),
        score: scoreWith(e.features, pos, neg, nPos - dPos, nNeg - dNeg, vocab),
      }
    }
    for (const i of idx) {
      const e = examples[i]!
      const bag = e.moods.includes(tag) ? pos : neg
      for (const k of e.features) bag.set(k, bag.get(k)! + 1)
    }
  }

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
 * 既定の 0.60 は実測で決めた。**探せることが第一で、多少の余計なヒットは許す**
 * という向きなので、適合率より再現率を採る側へ振ってある。実機 117 枚で、
 * キャラを丸ごと抜いて測った狙い値ごとの成績:
 *
 *     狙い   残るタグ  推した総数   「笑」適合/再現
 *     0.55   3        87        55% / 82%
 *     0.60   3        73        62% / 78%   ← ここ
 *     0.65   2        32        66% / 38%   ← 一気に拾えなくなる
 *
 * 以前は 1 枚抜きで線を引いて 0.65 にしていた。そのときは「笑 適合 69%」と
 * 出ていたが、**同じ人の別の枚が教師に残っていたぶん甘かった**（本当は 62%）。
 * ドヤ顔・照れ・ジト目も「適合 100%」として出していたが、その人を抜くと
 * 偶然以下に落ちる ── いまは出てこない。
 */
export function trainMoods(shots: Shot[], minPrecision = 0.6): MoodModel[] {
  const examples = toExamples(shots)
  if (examples.length < 20) return []
  const tags = [...new Set(examples.flatMap((e) => e.moods))]
  return tags
    .map((t) => trainTag(examples, t, minPrecision))
    .filter((m): m is MoodModel => m !== null)
}

/**
 * その枚で、喋っている人が写っているか。
 *
 * **ここがセリフから推すことの弱点。** 表情の札は**写っている顔**に付くのに、
 * セリフは**話者**のもの。別人が喋っている枚（相手の顔を映したリアクションの絵）
 * では、セリフから推した表情は写っている人のものではない。
 *
 * 実測（実機 139 枚）: 顔 1 個で話者も分かる 100 枚を、話者の情報を使わずに
 * 顔の見た目だけで当て直したところ ──
 *
 *     確信 >= 0.00   100 枚   話者と一致 87%
 *     確信 >= 0.15    85 枚   話者と一致 98%
 *     確信 >= 0.40    71 枚   話者と一致 100%   ← 仮で付ける線
 *
 * 確信が低いぶんの食い違いは、話者が違うのではなく**顔を当てられていない**
 * ほうだった。この素材（1 人ずつ映るストーリーの絵）では食い違いは稀だが、
 * 集合絵が増えれば起きる。
 *
 * **「違うと分かったときだけ止める」。** 分からないときは通す ── 探せることが
 * 第一で、顔が取れていない枚（実測で札付き 132 枚のうち 11 枚）まで落としたくない。
 */
export function speakerShown(shot: Shot): 'yes' | 'no' | 'unknown' {
  if (!shot.speakerId) return 'unknown'
  const faces = shot.faces ?? []
  const named = faces.filter((f) => f.characterId)
  if (!named.length) return 'unknown'
  if (named.some((f) => f.characterId === shot.speakerId)) return 'yes'
  // 写っている顔ぜんぶに名前が付いていて、どれも話者ではない ＝ 別人の絵。
  // 名前の付いていない顔が混じっているうちは、その中に居るかもしれないので止めない。
  return named.length === faces.length ? 'no' : 'unknown'
}

/** この 1 枚に、たぶん付く表情。手で振ってあるものは触らない。 */
export function guessMoods(shot: Shot, models: MoodModel[]): string[] {
  // 別人が喋っている絵では、セリフは写っている顔の表情を語っていない。
  if (speakerShown(shot) === 'no') return []
  const t = textOf(shot)
  if (!t || !models.length) return []
  const f = features(t)
  const already = new Set(shot.moods ?? [])
  return models
    .filter((m) => !already.has(m.tag))
    .filter((m) => scoreWith(f, m.pos, m.neg, m.nPos, m.nNeg, m.vocab) >= m.threshold)
    .map((m) => m.tag)
}
