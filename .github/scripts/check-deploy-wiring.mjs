/**
 * ビルドするアプリが、ちゃんとデプロイに繋がっているかを見る。
 *
 * アプリを増やしたときに deploy-pages.yml へ足し忘れると、テストも型検査も
 * 通ったまま「公開だけされない」という形で外れる。人間が気づくのはたいてい
 * 「あれ、URL を開いても 404 だ」のときなので、機械で止める。
 *
 * 見るのは 3 つだけ。
 *   1. そのアプリをビルドしているか（working-directory）
 *   2. 出来たものを _site へ運んでいるか（cp -r <app>/dist/*）
 *   3. 運び先のディレクトリを作っているか（mkdir -p ... _site/<app>）
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'

const WORKFLOW = '.github/workflows/deploy-pages.yml'
const yml = readFileSync(WORKFLOW, 'utf8')

const apps = readdirSync('.', { withFileTypes: true })
  .filter((e) => e.isDirectory() && !e.name.startsWith('.') && e.name !== 'node_modules')
  .map((e) => e.name)
  .filter((name) => existsSync(join(name, 'package.json')))
  .sort()

const problems = []
for (const app of apps) {
  if (!yml.includes(`working-directory: ${app}\n`)) {
    problems.push(`${app}: ${WORKFLOW} でビルドされていない（working-directory: ${app} が無い）`)
  }
  if (!yml.includes(`cp -r ${app}/dist/*`)) {
    problems.push(`${app}: 出来たものを _site へ運んでいない（cp -r ${app}/dist/* が無い）`)
  }
  if (!new RegExp(`mkdir -p [^\\n]*_site/${app}(\\s|$)`).test(yml)) {
    problems.push(`${app}: 運び先を作っていない（mkdir -p ... _site/${app} が無い）`)
  }
}

console.log(`ビルドするアプリ: ${apps.join(', ')}`)
if (problems.length) {
  console.error('\nデプロイの配線が足りていません:')
  for (const p of problems) console.error(`  - ${p}`)
  process.exit(1)
}
console.log('デプロイの配線はぜんぶ揃っている')
