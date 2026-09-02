// lbpcascade_animeface.xml を、実行時に読む小さな形へ畳む。
//
// 元は OpenCV の LBP カスケード（MIT、nagadomi 氏）。vendor/ に原本をそのまま
// 置いてあるので、出所とライセンスはそちらを見ればわかる。
// XML を実行時に解くのは無駄（241KB の文字列を毎回パースする）なので、
// ビルドのときに数値の並びへ直しておく。
import { readFileSync } from 'node:fs'

/**
 * 直下の `<_>…</_>` を切り出す。
 *
 * **入れ子になっているので、正規表現では切れない。**
 * 段の中に弱識別器の `<_>` が並んでいるため、非貪欲に読むと最初の `</_>` で
 * 止まり、弱識別器が 1 つも取れなかった（実測: 771 個 → 0 個）。深さを数える。
 */
function all(xml, tag) {
  const open = `<${tag}>`
  const close = `</${tag}>`
  const out = []
  let i = 0
  while (i < xml.length) {
    const start = xml.indexOf(open, i)
    if (start < 0) break
    let depth = 1
    let j = start + open.length
    while (depth > 0 && j < xml.length) {
      const nextOpen = xml.indexOf(open, j)
      const nextClose = xml.indexOf(close, j)
      if (nextClose < 0) throw new Error(`<${tag}> が閉じていません`)
      if (nextOpen >= 0 && nextOpen < nextClose) {
        depth++
        j = nextOpen + open.length
      } else {
        depth--
        j = nextClose + close.length
      }
    }
    out.push(xml.slice(start + open.length, j - close.length))
    i = j
  }
  return out
}

/** 同じ名前が入れ子にならないタグ（cascade / features / stages など）向け。 */
function one(xml, tag) {
  const start = xml.indexOf(`<${tag}>`)
  if (start < 0) return null
  const end = xml.indexOf(`</${tag}>`, start)
  if (end < 0) return null
  return xml.slice(start + tag.length + 2, end).trim()
}

const nums = (s) => s.trim().split(/\s+/).map(Number)

export function parseCascade(xml) {
  // <opencv_storage><cascade> の中だけを見る。
  const root = one(xml, 'cascade') ?? xml
  const width = Number(one(root, 'width'))
  const height = Number(one(root, 'height'))
  if (one(root, 'featureType') !== 'LBP') throw new Error('LBP のカスケードではありません')

  // 特徴は 3x3 の升目の、左上 1 マスぶんの矩形。
  const featuresXml = one(root, 'features')
  const rects = all(featuresXml, 'rect').map(nums)
  const features = new Int32Array(rects.length * 4)
  rects.forEach(([x, y, w, h], i) => features.set([x, y, w, h], i * 4))

  // 段ごとに「弱識別器を何個持つか」と「打ち切りのしきい値」。
  const stagesXml = one(root, 'stages')
  const stageBlocks = all(stagesXml, '_')
  const stageThreshold = new Float32Array(stageBlocks.length)
  const stageCount = new Int32Array(stageBlocks.length)

  // 弱識別器は「特徴 1 つ + 256 通りの分岐（8 語のビット集合）+ 葉 2 つ」。
  const featureIdx = []
  const subsets = []
  const leaves = []

  stageBlocks.forEach((block, si) => {
    stageThreshold[si] = Number(one(block, 'stageThreshold'))
    const weak = all(one(block, 'weakClassifiers'), '_')
    stageCount[si] = weak.length
    for (const w of weak) {
      // internalNodes は [left, right, featureIdx, subset x8]。
      // 木ではなく切り株なので left/right は使わない。
      const node = nums(one(w, 'internalNodes'))
      featureIdx.push(node[2])
      subsets.push(...node.slice(3, 11))
      leaves.push(...nums(one(w, 'leafValues')))
    }
  })

  if (subsets.length !== featureIdx.length * 8) throw new Error('subset の数が合いません')
  if (leaves.length !== featureIdx.length * 2) throw new Error('葉の数が合いません')

  return {
    width,
    height,
    features,
    stageThreshold,
    stageCount,
    featureIdx: new Int32Array(featureIdx),
    subsets: new Int32Array(subsets),
    leaves: new Float32Array(leaves),
  }
}

/** JSON にする（Float32Array などはただの配列に落とす）。 */
export function toJson(c) {
  return JSON.stringify({
    width: c.width,
    height: c.height,
    features: [...c.features],
    stageThreshold: [...c.stageThreshold].map((v) => Number(v.toFixed(6))),
    stageCount: [...c.stageCount],
    featureIdx: [...c.featureIdx],
    subsets: [...c.subsets],
    leaves: [...c.leaves].map((v) => Number(v.toFixed(6))),
  })
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const c = parseCascade(readFileSync(process.argv[2], 'utf8'))
  process.stdout.write(toJson(c))
}
