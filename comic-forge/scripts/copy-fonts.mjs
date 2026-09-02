// 同梱フォント（Zen Antique）を node_modules から public/fonts へ写す。
//
// 日本語フォントは 1 書体で数 MB ある。まるごと 1 ファイルで配ると初回が重いので、
// Google Fonts と同じ「文字の範囲ごとに切った塊」を並べ、@font-face の unicode-range で
// 使う塊だけ取りに行かせる。実測で全 118 塊 2.9MB、ふつうの台詞なら数塊で足りる。
//
// 配信元は自分のオリジンに揃える（実行時に CDN を見に行かない。media-vault / shot-bank と同じ流儀）。
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const pkg = join(root, 'node_modules', '@fontsource', 'zen-antique')
const outDir = join(root, 'public', 'fonts')
const filesDir = join(outDir, 'zen-antique')

rmSync(outDir, { recursive: true, force: true })
mkdirSync(filesDir, { recursive: true })

const unicode = JSON.parse(readFileSync(join(pkg, 'unicode.json'), 'utf8'))
const rules = []
let count = 0

for (const [key, range] of Object.entries(unicode)) {
  // "[12]" のような添字だけを使う。latin / japanese などの名前付き塊は
  // 添字の塊と中身が重なるので混ぜない。
  const m = /^\[(\d+)\]$/.exec(key)
  if (!m) continue
  const n = m[1]
  const src = join(pkg, 'files', `zen-antique-${n}-400-normal.woff2`)
  cpSync(src, join(filesDir, `${n}.woff2`))
  rules.push(
    `@font-face {\n` +
      `  font-family: 'Zen Antique';\n` +
      `  font-style: normal;\n` +
      `  font-weight: 400;\n` +
      `  font-display: swap;\n` +
      `  src: url(./zen-antique/${n}.woff2) format('woff2');\n` +
      `  unicode-range: ${range};\n` +
      `}`,
  )
  count++
}

// OFL は配布物にライセンス文を添えることを求めている。
cpSync(join(pkg, 'LICENSE'), join(filesDir, 'LICENSE.txt'))

writeFileSync(
  join(outDir, 'zen-antique.css'),
  `/* Zen Antique (SIL Open Font License 1.1) — ./zen-antique/LICENSE.txt\n` +
    `   scripts/copy-fonts.mjs が @fontsource/zen-antique から生成する。手で触らない。 */\n` +
    rules.join('\n\n') +
    '\n',
)

console.log(`copied ${count} font slices to public/fonts/zen-antique`)
