// tesseract.js の実行資材を node_modules から public/vendor へ写す。
// 配信元を自分のオリジンに揃えるため（実行時に CDN を見に行かない）。
// media-vault と同じ流儀。Whisper は使わないので ONNX Runtime は写さない。
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

console.log(`copied ${copies.length} vendor assets to public/vendor`)
console.log(`built animeface cascade (${cascade.stageCount.length} stages)`)
