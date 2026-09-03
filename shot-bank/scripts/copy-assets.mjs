// tesseract.js・ONNX Runtime Web の実行資材を node_modules から public/vendor へ写す。
// 配信元を自分のオリジンに揃えるため（実行時に CDN を見に行かない）。
// media-vault と同じ流儀。
import { cpSync, mkdirSync, rmSync, readFileSync, writeFileSync } from 'node:fs'
import { parseCascade, toJson } from './build-cascade.mjs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const nm = join(root, 'node_modules')
const out = join(root, 'public', 'vendor')

rmSync(out, { recursive: true, force: true })

const copies = [
  // OCR をメインスレッドの外で回すワーカ。
  ['tesseract.js/dist/worker.min.js', 'tesseract/worker.min.js'],
  // コア。端末の SIMD 対応に合わせてワーカが選ぶので 3 種とも置く。
  ...['tesseract-core-lstm', 'tesseract-core-simd-lstm', 'tesseract-core-relaxedsimd-lstm'].flatMap(
    (name) => [
      [`tesseract.js-core/${name}.wasm.js`, `tesseract-core/${name}.wasm.js`],
      [`tesseract.js-core/${name}.wasm`, `tesseract-core/${name}.wasm`],
    ],
  ),
  // 言語データ（LSTM 専用の best_int。小さくて精度が出る）。
  ['@tesseract.js-data/jpn/4.0.0_best_int/jpn.traineddata.gz', 'tessdata/jpn.traineddata.gz'],
  ['@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz', 'tessdata/eng.traineddata.gz'],
  // ONNX Runtime Web。表情タグの画像推定でだけ使うので、アプリ本体には効かない
  // （呼び出し側で動的 import する。ここは配る場所を用意するだけ）。
  // SharedArrayBuffer が要る「スレッド版」の中身だが、GitHub Pages はヘッダを
  // 選べず cross-origin isolation ができないので、呼び出し側で numThreads=1 に
  // 固定してシングルスレッドとして使う（同じ .wasm がどちらにも対応している）。
  ['onnxruntime-web/dist/ort.wasm.min.mjs', 'ort/ort.wasm.min.mjs'],
  ['onnxruntime-web/dist/ort-wasm-simd-threaded.wasm', 'ort/ort-wasm-simd-threaded.wasm'],
  // wasm を起動する glue コード（Emscripten 生成）。wasm 本体と対で要る。
  ['onnxruntime-web/dist/ort-wasm-simd-threaded.mjs', 'ort/ort-wasm-simd-threaded.mjs'],
]

for (const [from, to] of copies) {
  const dest = join(out, to)
  mkdirSync(dirname(dest), { recursive: true })
  cpSync(join(nm, from), dest)
}

// アニメ顔の検出器（lbpcascade_animeface、MIT）。原本の XML は vendor/ に置いてある。
// 241KB の XML を実行時に解くのは無駄なので、数値の並びに畳んでから配る（87KB）。
const cascade = parseCascade(readFileSync(join(root, 'vendor/lbpcascade_animeface.xml'), 'utf8'))
const cascadeOut = join(out, 'animeface/cascade.json')
mkdirSync(dirname(cascadeOut), { recursive: true })
writeFileSync(cascadeOut, toJson(cascade))

// 表情の画像タガー（wd-vit-tagger-v3 を動的量子化。Apache-2.0）。
// モデル本体はそのまま配る。タグの対応表（10,861 行の CSV）だけ、実行時に
// パースする無駄を省くために JSON へ畳んでおく。
const wdOut = join(out, 'wd-tagger')
mkdirSync(wdOut, { recursive: true })
cpSync(join(root, 'vendor/wd-tagger/model.quant.onnx'), join(wdOut, 'model.onnx'))
const tagsCsv = readFileSync(join(root, 'vendor/wd-tagger/selected_tags.csv'), 'utf8').trim().split('\n')
const tagsHeader = tagsCsv[0].split(',')
const nameIdx = tagsHeader.indexOf('name')
const catIdx = tagsHeader.indexOf('category')
const tags = tagsCsv.slice(1).map((line) => {
  const cols = line.split(',')
  return [cols[nameIdx], Number(cols[catIdx])]
})
writeFileSync(join(wdOut, 'tags.json'), JSON.stringify(tags))

console.log(`copied ${copies.length} vendor assets to public/vendor`)
console.log(`built animeface cascade (${cascade.stageCount.length} stages)`)
console.log(`built wd-tagger tag table (${tags.length} tags)`)
