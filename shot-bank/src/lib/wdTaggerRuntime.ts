import { vendorUrl } from './vendor'
import type { WdTag } from './imageMoodGuess'
import { cropForTagger, TAGGER_INPUT_SIZE } from './imageMoodGuess'
import type { Pixels } from './pixels'
import type { Face } from './types'

/**
 * 画像タガー（wd-vit-tagger-v3）の実行だけを担う。前処理・判定の中身は
 * imageMoodGuess.ts（純関数・テスト可能）。ここは重い ONNX Runtime を
 * 読み込んで動かす、DOM 依存の薄い層。
 *
 * **onnxruntime-web は動的 import。** 97MB のモデルと 14MB の ONNX Runtime
 * 本体を、この機能を実際に使う回だけ取りに行く（App 側で確認ダイアログの
 * OK を押した回だけ呼ぶ）。
 *
 * **シングルスレッド固定。** GitHub Pages はレスポンスヘッダを選べないので
 * cross-origin isolation ができず、SharedArrayBuffer が使えない。
 * `numThreads: 1` にすれば、同じ .wasm がスレッドを使わずに動く。
 */

let sessionPromise: Promise<import('onnxruntime-web/wasm').InferenceSession> | null = null
let tagsPromise: Promise<WdTag[]> | null = null

async function loadSession() {
  const ort = await import('onnxruntime-web/wasm')
  ort.env.wasm.wasmPaths = vendorUrl('ort/')
  ort.env.wasm.numThreads = 1
  return ort.InferenceSession.create(vendorUrl('wd-tagger/model.onnx'), {
    executionProviders: ['wasm'],
  })
}

async function loadTags(): Promise<WdTag[]> {
  const res = await fetch(vendorUrl('wd-tagger/tags.json'))
  if (!res.ok) throw new Error(`タグ表を取得できませんでした: ${res.status}`)
  return res.json()
}

/** 一度読み込んだら使い回す。タブを閉じるまで再取得しない。 */
export function preloadWdTagger(): Promise<void> {
  sessionPromise ??= loadSession()
  tagsPromise ??= loadTags()
  return Promise.all([sessionPromise, tagsPromise]).then(() => undefined)
}

/**
 * タグ表だけ読み込む。**ONNX 本体（97MB＋実行環境 14MB）は読まない。**
 * 保存済みスコアだけで判定し直す経路（guessMoodsFromStoredScores）は、
 * 全部の顔がすでに採ってあれば ONNX を一度も読み込まずに済む。
 */
export function preloadWdTags(): Promise<WdTag[]> {
  tagsPromise ??= loadTags()
  return tagsPromise
}

export function isWdTaggerLoaded(): boolean {
  return sessionPromise !== null
}

/** 顔 1 個ぶんの生スコア（sigmoid 前）を得る。読み込みが済んでいなければ待つ。 */
export async function runWdTagger(px: Pixels, face: Face): Promise<{ scores: Float32Array; tags: WdTag[] }> {
  await preloadWdTagger()
  const [session, tags] = await Promise.all([sessionPromise!, tagsPromise!])
  const ort = await import('onnxruntime-web/wasm')

  const input = cropForTagger(px, face)
  const tensor = new ort.Tensor('float32', input, [1, TAGGER_INPUT_SIZE, TAGGER_INPUT_SIZE, 3])
  const inputName = session.inputNames[0]!
  const outputName = session.outputNames[0]!
  const out = await session.run({ [inputName]: tensor })
  const scores = out[outputName]!.data as Float32Array
  return { scores, tags }
}
