/**
 * 変更のあったアプリだけを CI に回す。
 *
 * このリポジトリは 1 つの中に独立したアプリが 9 つ入っている。毎回ぜんぶ回すと
 * 1 行直しただけで 9 回の npm ci が走るので、触ったところだけを選ぶ。
 *
 * 迷ったら「ぜんぶ回す」に倒す。取りこぼして素通りさせるより、余分に回すほうが安い。
 *
 * 出力（GITHUB_OUTPUT）:
 *   apps=["comic-forge","shot-bank"]   マトリクスにそのまま渡せる JSON 配列
 */
import { execFileSync } from 'node:child_process'
import { appendFileSync, readdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'

/** package.json を持つ直下のディレクトリ＝ビルドするアプリ。 */
function findApps() {
  return readdirSync('.', { withFileTypes: true })
    .filter((e) => e.isDirectory() && !e.name.startsWith('.') && e.name !== 'node_modules')
    .map((e) => e.name)
    .filter((name) => existsSync(join(name, 'package.json')))
    .sort()
}

function git(...args) {
  return execFileSync('git', args, { encoding: 'utf8' })
}

/** 比較の起点。取れなければ null（＝ぜんぶ回す）。 */
function baseRef() {
  const event = process.env.GITHUB_EVENT_NAME
  if (event === 'pull_request') {
    const base = process.env.GITHUB_BASE_REF
    if (!base) return null
    try {
      git('fetch', '--no-tags', 'origin', base)
    } catch {
      // 取れなくても、すでに手元にあるかもしれないので続ける
    }
    try {
      return git('merge-base', `origin/${base}`, 'HEAD').trim()
    } catch {
      return null
    }
  }
  const before = process.env.GITHUB_EVENT_BEFORE
  // 新しいブランチの初回 push は 000... になる
  if (before && !/^0+$/.test(before)) {
    try {
      git('cat-file', '-e', `${before}^{commit}`)
      return before
    } catch {
      return null
    }
  }
  return null
}

const apps = findApps()
const base = baseRef()

let selected
if (!base) {
  selected = apps
  console.log('比較の起点が取れないので、ぜんぶ回す')
} else {
  const changed = git('diff', '--name-only', `${base}...HEAD`).split('\n').filter(Boolean)
  console.log(`変更 ${changed.length} 件（${base.slice(0, 7)} から）`)

  // 仕組みそのものが変わったときは、ぜんぶ回す
  const shared = changed.some((p) => p.startsWith('.github/'))
  if (shared) {
    selected = apps
    console.log('.github/ が変わっているので、ぜんぶ回す')
  } else {
    const hit = new Set()
    for (const path of changed) {
      const top = path.split('/')[0]
      if (apps.includes(top)) hit.add(top)
    }
    selected = apps.filter((a) => hit.has(a))
  }
}

console.log('回すアプリ:', selected.length ? selected.join(', ') : '（なし）')
if (process.env.GITHUB_OUTPUT) {
  appendFileSync(process.env.GITHUB_OUTPUT, `apps=${JSON.stringify(selected)}\n`)
}
