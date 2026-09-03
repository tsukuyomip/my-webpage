import type { Pixels } from './pixels'
import type { Face } from './types'

/**
 * セリフだけでなく、**顔の絵からも**表情を推す。
 *
 * ## なぜ絵を諦めなかったのか
 *
 * `moodGuess.ts`（セリフ版）には弱点がある ── 表情の札は「写っている顔」に
 * 付くのに、セリフは「話者」のもの。別人が喋っている絵では原理的に外れる
 * （`speakerShown` で分かるときだけ止めているが、根本の解決ではない）。
 *
 * 自前の記述子（色・勾配）で表情を測ったときは落とした（実機 118 顔、平均
 * AUC 0.53〜0.58）。**汎用の事前学習タガーなら別**ではと測り直した:
 *
 *     wd-vit-tagger-v3（danbooru で学習した画像タガー、Apache-2.0）
 *
 * を使うと、実機 117 顔で強い信号が出た（下表）── 自前の記述子や、セリフ版
 * のどのタグより強い。
 *
 * ## 資材について
 *
 * 量子化した ONNX で 97MB（元は 379MB）。**初回だけ、確認ダイアログを
 * 挟んだ手動起動でのみ取得する**（App 側）。一度取れば Service Worker の
 * キャッシュに乗るので、以後の再取得は無い。
 *
 * 量子化は一度壊した ── `onnxruntime.quantization.preprocess` を飛ばしたら
 * 黒でも白でも出力がほぼ同じになった（差 0.6／全 10,861 出力）。前処理を
 * 通してもまだ壊れていた（差 0.4）ので、**量子化ではなく前処理側**を疑って
 * 正解だった。原因は正規化 ── README のコード例（timm 版）は `-1..1` に
 * 正規化していたが、ONNX 版は「v2 系のコードと互換」と書いてあるだけあって
 * **生の 0..255 をそのまま**受け取る（黒白の差: -1..1 も 0..1 も 0.1、
 * 0..255 だけ 21.2）。BGR への並べ替え（README のコード例のコメントに
 * 明記）は変わらず必要。
 *
 * ## 実測 ── 2 つしくじって、直した記録
 *
 * ### 1 回目のしくじり：JPEG 圧縮を挟んで測っていた
 *
 * 最初は、切り出した顔を JPEG（品質 92）で保存してから測っていた。ブラウザは
 * 無劣化の canvas から直接 448×448 を作るので、**実際に配る形と測った形が
 * 違っていた。** 気づいたきっかけは、実機と同じ Chromium で通したときに
 * 「doyagao・jitome・nervous・dirty_face が軒並みちょうど 0.500
 * （sigmoid(0) ＝ モデルが「分からない」と言っている値）で、閾値の `>= 0.5`
 * にちょうど触れて出ていた」こと。JPEG 版では同じ画像でこれらが 0.5〜0.6 台に
 * 見えていた ── 圧縮のぼかしが、境界線上のスコアを通る側へ押し上げていた。
 * 無劣化（PNG）で測り直した。
 *
 * ### 2 回目のしくじり：量子化で死んだ出力を、生きている振りで拾っていた
 *
 * 無劣化で測り直してもなお、**別の枚**（怒だけが手札の枚）で「怒」がまったく
 * 出ず、代わりに ジト目・困・ドン引き が出るという、初回と同じ組が出た。
 * 疑って 117 枚全部の生スコアの標準偏差を見たところ ──
 *
 *     angry・annoyed・doyagao・narrowed_eyes・jitome・scared・nervous・
 *     happy・grin・surprised・dirty_face … 標準偏差 0.0000〜0.0071
 *     smile・blush・smug・sad                    … 標準偏差 0.013〜0.090
 *
 * **`dirty_face` は 117 枚全部が寸分違わず 0.500。** 量子化でこれらの出力
 * チャンネルが定数に潰れていた。1 つ抜きの精度・再現率の測り方（trainTag と
 * 同じ発想）は、値が横並びのときソートの安定順（＝元の並び順）をなぞるだけに
 * なる。たまたま正例が前のほうに集まっていれば、中身の無いタグでも
 * 「精度 60% 達成」に見えてしまう。**AUC も同じ罠にかかっていた** ──
 * narrowed_eyes の AUC 0.924 は、実際には 0.0003 の量子化ノイズにラベルが
 * 偶然そろっていただけだった。
 *
 * **直した:** 標準偏差 0.012 未満のタグを候補から除外してから、残りだけで
 * 選び直した。ジト目は、生きている候補の上位が軒並み `blonde_hair`・
 * `yellow_eyes`（表情ではなくキャラの特徴）で、表情そのものの候補が無かった
 * ため**見送った**。代わりに、死んだ候補に隠れて見えていなかった
 * `expressionless`（真顔そのものの単語）が見つかり、**真顔は逆に拾えた**
 * （最初の測定では「候補が全部逆相関」と見送っていたが、あれも死んだ
 * チャンネルのノイズを拾った誤りだった）。
 *
 * ### 最終的な実測（無劣化・生きているタグだけ）
 *
 * 「異キャラのみ」は、同じ人どうしの組を除いて測った AUC。ここが素の AUC と
 * 近ければ、キャラ識別ではなく表情そのものを見ている。
 *
 *     ムード   WD タグ          全体    異キャラのみ   n
 *     笑       smile           0.948    0.949         53
 *     照れ     blush           0.890    0.889         33
 *     困       tears           0.841    0.839         31
 *     ドヤ顔    smug            0.856    0.855         19
 *     喜       ^_^             0.779    0.778         19
 *     真顔     expressionless  0.778    0.774         18
 *     怒       frown           0.874    0.874         16
 *     ドン引き  sweatdrop       0.853    0.858          9（少ない）
 *     驚き     :o              0.782    0.791          9（少ない）
 *     哀       sad             0.947    0.956          6（少なすぎて線が引けない）
 *     ジト目    ―               ―        ―             12（生きている候補が無い。見送り）
 *
 * 哀・ジト目は見送った。哀は n=6 では狙った適合率にどの閾値も届かない。
 * ジト目は上のとおりキャラの特徴しか拾えなかった。
 */

/** 元画像を、モデルが受け取れる形（正方形パディング→448 リサイズ→BGR）に切り出す。 */
export const TAGGER_INPUT_SIZE = 448

/**
 * 顔枠の周りを少し広げて、正方形へ白地パディングしてから 448×448 に縮小・
 * 拡大する。**縮小はバイリニア**（実測時と同じ。ここを変えると閾値がずれる）。
 *
 * 返り値は NHWC・BGR・0..255 の生の値（正規化はしない。実測で確認した並び）。
 */
export function cropForTagger(px: Pixels, face: Face): Float32Array {
  const N = TAGGER_INPUT_SIZE
  // 顔の輪郭より外側（表情に関わる眉・輪郭）も少し拾う。
  const pad = Math.round(Math.max(face.w, face.h) * 0.15)
  const x0 = Math.max(0, Math.round(face.x - pad))
  const y0 = Math.max(0, Math.round(face.y - pad))
  const x1 = Math.min(px.width, Math.round(face.x + face.w + pad))
  const y1 = Math.min(px.height, Math.round(face.y + face.h + pad))
  const cw = Math.max(1, x1 - x0)
  const ch = Math.max(1, y1 - y0)

  // 正方形へ白地パディング。
  const side = Math.max(cw, ch)
  const ox = Math.floor((side - cw) / 2)
  const oy = Math.floor((side - ch) / 2)

  // 正方形の中の (sx,sy) の画素を、切り出し元の座標へ逆算して読む
  // （中間バッファを作らず、リサイズ元として直接使うため）。
  const sampleSquare = (sx: number, sy: number): [number, number, number] => {
    const ix = sx - ox
    const iy = sy - oy
    if (ix < 0 || iy < 0 || ix >= cw || iy >= ch) return [255, 255, 255]
    const i = ((y0 + iy) * px.width + (x0 + ix)) * 4
    return [px.data[i]!, px.data[i + 1]!, px.data[i + 2]!]
  }

  const out = new Float32Array(N * N * 3)
  for (let y = 0; y < N; y++) {
    const fy = ((y + 0.5) * side) / N - 0.5
    const y0i = Math.max(0, Math.floor(fy))
    const y1i = Math.min(side - 1, y0i + 1)
    const wy = fy - y0i
    for (let x = 0; x < N; x++) {
      const fx = ((x + 0.5) * side) / N - 0.5
      const x0i = Math.max(0, Math.floor(fx))
      const x1i = Math.min(side - 1, x0i + 1)
      const wx = fx - x0i

      const p00 = sampleSquare(x0i, y0i)
      const p10 = sampleSquare(x1i, y0i)
      const p01 = sampleSquare(x0i, y1i)
      const p11 = sampleSquare(x1i, y1i)

      const di = (y * N + x) * 3
      for (let c = 0; c < 3; c++) {
        const top = p00[c]! + (p10[c]! - p00[c]!) * wx
        const bot = p01[c]! + (p11[c]! - p01[c]!) * wx
        const v = top + (bot - top) * wy
        // RGB -> BGR（c: 0=R,1=G,2=B を並べ替えて書く）。
        out[di + (2 - c)] = v
      }
    }
  }
  return out
}

/** タグの対応表（tags.json）の 1 行。category '0' が一般タグ。 */
export type WdTag = [name: string, category: number]

/** ムード → 見る WD タグと閾値。実測（上のコメント）で決めた。 */
interface WdRule {
  tag: string
  threshold: number
}

const WD_RULES: Record<string, WdRule> = {
  笑: { tag: 'smile', threshold: 0.606 },
  照れ: { tag: 'blush', threshold: 0.582 },
  困: { tag: 'tears', threshold: 0.501 },
  ドヤ顔: { tag: 'smug', threshold: 0.505 },
  喜: { tag: '^_^', threshold: 0.574 },
  真顔: { tag: 'expressionless', threshold: 0.518 },
  怒: { tag: 'frown', threshold: 0.54 },
  ドン引き: { tag: 'sweatdrop', threshold: 0.621 },
  驚き: { tag: ':o', threshold: 0.633 },
}

function sigmoid(x: number): number {
  return 1 / (1 + Math.exp(-x))
}

/**
 * モデルの生の出力（sigmoid をかける前）から、ムードを判定する。
 * 手で振ってあるものは触らない（セリフ版と同じ規則）。
 */
export function guessMoodsFromScores(
  rawScores: ArrayLike<number>,
  tags: WdTag[],
  already: string[] | undefined,
): string[] {
  const already_ = new Set(already ?? [])
  const nameToIndex = new Map(tags.map((t, i) => [t[0], i]))
  const out: string[] = []
  for (const [mood, rule] of Object.entries(WD_RULES)) {
    if (already_.has(mood)) continue
    const idx = nameToIndex.get(rule.tag)
    if (idx === undefined) continue
    if (sigmoid(rawScores[idx]!) >= rule.threshold) out.push(mood)
  }
  return out
}
