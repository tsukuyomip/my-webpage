import { afterEach, describe, expect, it, vi } from 'vitest'
import { canReadClipboard, readClipboardImages } from '../clipboardImages'

/** ClipboardItem のふりをする最小のもの。 */
const item = (types: string[], blobs?: Record<string, Blob>) => ({
  types,
  getType: async (t: string) => {
    const b = blobs?.[t]
    if (!b) throw new Error('無い')
    return b
  },
})

const png = () => new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' })

const stub = (read: () => Promise<unknown[]>) =>
  vi.stubGlobal('navigator', { clipboard: { read } })

afterEach(() => vi.unstubAllGlobals())

describe('クリップボードから画像を取り出す', () => {
  it('画像を File にして返す', async () => {
    stub(async () => [item(['image/png'], { 'image/png': png() })])
    const r = await readClipboardImages()
    expect(r.kind).toBe('files')
    if (r.kind !== 'files') return
    expect(r.files).toHaveLength(1)
    expect(r.files[0]!.type).toBe('image/png')
    // 名前は付け直す。クリップボードの絵は名前を持っていない。
    expect(r.files[0]!.name).toMatch(/^clip-\d{8}-\d{6}-1\.png$/)
  })

  it('同じ絵が複数の形で入っていても 1 つだけ採る', async () => {
    // iOS は png と HTML の両方を入れてくることがある。両方取ると二重になる。
    stub(async () => [
      item(['text/html', 'image/png'], { 'image/png': png() }),
    ])
    const r = await readClipboardImages()
    expect(r.kind === 'files' && r.files).toHaveLength(1)
  })

  it('複数枚まとめて取り込める', async () => {
    stub(async () => [
      item(['image/png'], { 'image/png': png() }),
      item(['image/png'], { 'image/png': png() }),
    ])
    const r = await readClipboardImages()
    expect(r.kind === 'files' && r.files).toHaveLength(2)
    if (r.kind !== 'files') return
    // 名前が重ならない。同名だと取り込みで見分けが付かない。
    expect(new Set(r.files.map((f) => f.name)).size).toBe(2)
  })

  it('1 つ読めなくても、残りは取り込む', async () => {
    stub(async () => [item(['image/png']), item(['image/png'], { 'image/png': png() })])
    const r = await readClipboardImages()
    expect(r.kind === 'files' && r.files).toHaveLength(1)
  })

  it('画像が無ければ、そう返す', async () => {
    stub(async () => [item(['text/plain'])])
    expect((await readClipboardImages()).kind).toBe('empty')
  })

  it('許可されなければ、そう返す', async () => {
    // iOS は読むたびに確認を出す。断られても失敗扱いにはしない。
    stub(async () => {
      throw new DOMException('denied', 'NotAllowedError')
    })
    expect((await readClipboardImages()).kind).toBe('denied')
  })

  it('読めない環境では、そう返す', async () => {
    vi.stubGlobal('navigator', {})
    expect(canReadClipboard()).toBe(false)
    expect((await readClipboardImages()).kind).toBe('unsupported')
  })

  it('読める環境なら true', () => {
    stub(async () => [])
    expect(canReadClipboard()).toBe(true)
  })
})
