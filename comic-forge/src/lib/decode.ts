/**
 * 画像の復号を 1 か所にまとめる。
 *
 * `createImageBitmap` は速いが、**対応している形式も引数も端末で違う**。
 * iOS では HEIC で落ちることがあり、縮小の指定（resizeWidth）を見ないこともある。
 * ここで「落ちたら img 要素で読み直す」「縮小は自分でやる」を引き受けて、
 * 呼ぶ側は端末差を気にしないで済むようにする。
 */

export interface Decoded {
  source: CanvasImageSource
  width: number
  height: number
  close: () => void
}

/** その端末で何が使えるか。動かないときの切り分けに使う。 */
export function imageSupport(): Record<string, boolean> {
  return {
    createImageBitmap: typeof createImageBitmap === 'function',
    canvasToBlob: typeof document.createElement('canvas').toBlob === 'function',
    cryptoSubtle: typeof crypto !== 'undefined' && !!crypto.subtle,
    indexedDB: typeof indexedDB !== 'undefined',
    offscreen: typeof OffscreenCanvas !== 'undefined',
  }
}

async function viaImageElement(blob: Blob): Promise<Decoded> {
  const url = URL.createObjectURL(blob)
  try {
    const img = new Image()
    img.decoding = 'async'
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve()
      img.onerror = () =>
        reject(new Error(`img 要素でも開けませんでした（${blob.type || '形式不明'}）`))
      img.src = url
    })
    const width = img.naturalWidth || img.width
    const height = img.naturalHeight || img.height
    if (!width || !height) throw new Error('画像の大きさが 0 でした')
    return { source: img, width, height, close: () => URL.revokeObjectURL(url) }
  } catch (e) {
    URL.revokeObjectURL(url)
    throw e
  }
}

/**
 * 復号する。createImageBitmap が第一手、駄目なら img 要素。
 * どちらも駄目なら、両方の理由をまとめて投げる（片方だけだと切り分けられない）。
 */
export async function decodeImage(blob: Blob): Promise<Decoded> {
  let first = ''
  if (typeof createImageBitmap === 'function') {
    try {
      const bitmap = await createImageBitmap(blob)
      if (bitmap.width > 0 && bitmap.height > 0) {
        return {
          source: bitmap,
          width: bitmap.width,
          height: bitmap.height,
          close: () => bitmap.close(),
        }
      }
      bitmap.close()
      first = 'createImageBitmap が大きさ 0 を返した'
    } catch (e) {
      first = `createImageBitmap: ${describeError(e)}`
    }
  } else {
    first = 'createImageBitmap が無い'
  }

  try {
    return await viaImageElement(blob)
  } catch (e) {
    throw new Error(`${first} / ${describeError(e)}`)
  }
}

/** 指定した幅を超えないところまで縮めて復号する。編集中の表示と書き出しで使う。 */
export async function decodeAt(blob: Blob, wantWidth: number): Promise<Decoded> {
  const full = await decodeImage(blob)
  if (full.width <= wantWidth) return full

  const w = Math.max(1, Math.round(wantWidth))
  const h = Math.max(1, Math.round((full.height * w) / full.width))
  try {
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('2d コンテキストが取れませんでした')
    ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(full.source, 0, 0, w, h)
    full.close()
    // canvas そのものを描画元にできる。もう一度復号し直す必要はない。
    return { source: canvas, width: w, height: h, close: () => { canvas.width = 0; canvas.height = 0 } }
  } catch {
    // 縮められなくても、原寸のまま描けば絵は出る。止めない。
    return full
  }
}

/** 例外を人が読める 1 行にする。Error でないものが飛んできても潰さない。 */
export function describeError(e: unknown): string {
  if (e instanceof Error) return `${e.name}: ${e.message}`
  if (typeof e === 'string') return e
  if (e === undefined) return '理由の分からない失敗（undefined）'
  if (e === null) return '理由の分からない失敗（null）'
  try {
    return JSON.stringify(e)
  } catch {
    return String(e)
  }
}

/** どの段で転んだかを持つ失敗。「読めませんでした」だけでは次の手が分からない。 */
export class StepError extends Error {
  constructor(
    public step: string,
    cause: unknown,
    public detail = '',
  ) {
    super(`${step}: ${describeError(cause)}${detail ? `（${detail}）` : ''}`)
    this.name = 'StepError'
  }
}

/**
 * その端末で画像まわりが本当に動くかを、実際に通して調べる。
 *
 * 実機でしか出ない不具合を手元で再現できないので、端末に自分で答えさせる。
 * 小さな絵を 1 枚こしらえて、復号 → 縮小 → JPEG 化 → 指紋、と本番と同じ道を通す。
 */
export async function selfTest(): Promise<string> {
  const lines: string[] = []
  const support = imageSupport()
  lines.push('使えるもの:')
  for (const [k, v] of Object.entries(support)) lines.push(`  ${v ? '○' : '×'} ${k}`)

  const step = async (name: string, run: () => Promise<string>) => {
    try {
      lines.push(`○ ${name}: ${await run()}`)
      return true
    } catch (e) {
      lines.push(`× ${name}: ${describeError(e)}`)
      return false
    }
  }

  // 元になる絵を 1 枚こしらえる
  let seed: Blob | null = null
  await step('絵をこしらえる', async () => {
    const c = document.createElement('canvas')
    c.width = 64
    c.height = 40
    const ctx = c.getContext('2d')
    if (!ctx) throw new Error('2d コンテキストが取れない')
    ctx.fillStyle = '#3da9fc'
    ctx.fillRect(0, 0, 64, 40)
    seed = await new Promise<Blob>((resolve, reject) => {
      c.toBlob((b) => (b ? resolve(b) : reject(new Error('toBlob が空を返した'))), 'image/png')
    })
    return `${seed.size} バイトの PNG`
  })
  if (!seed) return lines.join('\n')

  await step('createImageBitmap で開く', async () => {
    if (typeof createImageBitmap !== 'function') throw new Error('この端末には無い')
    const b = await createImageBitmap(seed!)
    const size = `${b.width}x${b.height}`
    b.close()
    return size
  })
  await step('img 要素で開く', async () => {
    const d = await viaImageElement(seed!)
    const size = `${d.width}x${d.height}`
    d.close()
    return size
  })
  await step('JPEG に焼き直す', async () => {
    const d = await decodeImage(seed!)
    const c = document.createElement('canvas')
    c.width = 32
    c.height = 20
    const ctx = c.getContext('2d')
    if (!ctx) throw new Error('2d コンテキストが取れない')
    ctx.drawImage(d.source, 0, 0, 32, 20)
    d.close()
    const jpg = await new Promise<Blob>((resolve, reject) => {
      c.toBlob((b) => (b ? resolve(b) : reject(new Error('toBlob が空を返した'))), 'image/jpeg', 0.88)
    })
    return `${jpg.size} バイト`
  })
  await step('指紋を取る', async () => {
    if (!crypto?.subtle) throw new Error('crypto.subtle が無い（簡易ハッシュに落ちる）')
    const digest = await crypto.subtle.digest('SHA-256', await seed!.arrayBuffer())
    return `${digest.byteLength} バイト`
  })

  return lines.join('\n')
}
