// Copies the Tesseract OCR runtime assets from node_modules into
// public/vendor so the deployed app serves everything from its own origin
// (no runtime CDN dependency). Same approach as ../media-vault.
// Only the eng traineddata is needed: we OCR nothing but "Lv" digits.
import { cpSync, mkdirSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const nm = join(root, 'node_modules')
const out = join(root, 'public', 'vendor')

rmSync(out, { recursive: true, force: true })

const copies = [
  // Tesseract worker script (runs OCR off the main thread).
  ['tesseract.js/dist/worker.min.js', 'tesseract/worker.min.js'],
  // Tesseract core. The worker picks the *-lstm variant matching the
  // device's SIMD support (we always run LSTM-only, the v7 default).
  ...[
    'tesseract-core-lstm',
    'tesseract-core-simd-lstm',
    'tesseract-core-relaxedsimd-lstm',
  ].flatMap((name) => [
    [`tesseract.js-core/${name}.wasm.js`, `tesseract-core/${name}.wasm.js`],
    [`tesseract.js-core/${name}.wasm`, `tesseract-core/${name}.wasm`],
  ]),
  ['@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz', 'tessdata/eng.traineddata.gz'],
]

for (const [from, to] of copies) {
  const dest = join(out, to)
  mkdirSync(dirname(dest), { recursive: true })
  cpSync(join(nm, from), dest)
}

console.log(`copied ${copies.length} vendor assets to public/vendor`)
