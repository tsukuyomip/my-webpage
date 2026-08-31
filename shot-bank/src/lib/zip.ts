// 依存なしの最小 ZIP。書き出しは無圧縮 store（画像は既に圧縮済み）、
// 読み込みは store と deflate の両方を受ける（他のツールで作り直した ZIP も戻せるように）。
// 書き出し側は gkms-sprtcrd の実装と同じ流儀。

export interface ZipEntry {
  path: string
  blob: Blob
}

const CRC_TABLE = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()

function crc32(buf: Uint8Array): number {
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

const encoder = new TextEncoder()
const decoder = new TextDecoder()

/**
 * ZipEntry[] を 1 つの ZIP Blob にする（store, 無圧縮）。
 * CRC を取るために 1 件ずつ読むが、本体は読んだバイト列ではなく元の Blob を継ぎ足す。
 * こうしないと数百枚のバックアップで全画像がメモリに載る。
 */
export async function makeZip(entries: ZipEntry[]): Promise<Blob> {
  const chunks: BlobPart[] = []
  const central: Uint8Array[] = []
  let offset = 0

  for (const entry of entries) {
    const nameBytes = encoder.encode(entry.path)
    const bytes = new Uint8Array(await entry.blob.arrayBuffer())
    const crc = crc32(bytes)
    const size = bytes.length

    const local = new Uint8Array(30 + nameBytes.length)
    const lv = new DataView(local.buffer)
    lv.setUint32(0, 0x04034b50, true)
    lv.setUint16(4, 20, true)
    lv.setUint16(6, 0x0800, true) // UTF-8 のファイル名
    lv.setUint16(8, 0, true) // store
    lv.setUint32(14, crc, true)
    lv.setUint32(18, size, true)
    lv.setUint32(22, size, true)
    lv.setUint16(26, nameBytes.length, true)
    local.set(nameBytes, 30)

    chunks.push(local, entry.blob)

    const cd = new Uint8Array(46 + nameBytes.length)
    const cv = new DataView(cd.buffer)
    cv.setUint32(0, 0x02014b50, true)
    cv.setUint16(4, 20, true)
    cv.setUint16(6, 20, true)
    cv.setUint16(8, 0x0800, true)
    cv.setUint16(10, 0, true)
    cv.setUint32(16, crc, true)
    cv.setUint32(20, size, true)
    cv.setUint32(24, size, true)
    cv.setUint16(28, nameBytes.length, true)
    cv.setUint32(42, offset, true)
    cd.set(nameBytes, 46)
    central.push(cd)

    offset += local.length + size
  }

  const centralSize = central.reduce((a, c) => a + c.length, 0)
  const end = new Uint8Array(22)
  const ev = new DataView(end.buffer)
  ev.setUint32(0, 0x06054b50, true)
  ev.setUint16(8, entries.length, true)
  ev.setUint16(10, entries.length, true)
  ev.setUint32(12, centralSize, true)
  ev.setUint32(16, offset, true)

  const parts = [...chunks, ...central, end] as unknown as BlobPart[]
  return new Blob(parts, { type: 'application/zip' })
}

async function inflateRaw(data: Blob): Promise<Blob> {
  const DS = (globalThis as { DecompressionStream?: typeof DecompressionStream }).DecompressionStream
  if (!DS) throw new Error('この ZIP は圧縮されていますが、ブラウザが展開に対応していません')
  const stream = data.stream().pipeThrough(new DS('deflate-raw'))
  return await new Response(stream).blob()
}

/**
 * ZIP を読んで path → 中身 の Map にする。
 * 全体を ArrayBuffer にせず Blob のスライスで扱うので、大きなバックアップでも展開できる。
 */
export async function readZip(file: Blob): Promise<Map<string, Blob>> {
  // 末尾から End of Central Directory を探す（コメントは最大 65535 バイト）。
  const tailLen = Math.min(file.size, 22 + 0xffff)
  const tailStart = file.size - tailLen
  const tail = new DataView(await file.slice(tailStart).arrayBuffer())
  let eocd = -1
  for (let i = tailLen - 22; i >= 0; i--) {
    if (tail.getUint32(i, true) === 0x06054b50) {
      eocd = i
      break
    }
  }
  if (eocd < 0) throw new Error('ZIP として読めませんでした')

  const count = tail.getUint16(eocd + 10, true)
  const centralSize = tail.getUint32(eocd + 12, true)
  const centralOffset = tail.getUint32(eocd + 16, true)
  const central = new DataView(
    await file.slice(centralOffset, centralOffset + centralSize).arrayBuffer(),
  )

  const out = new Map<string, Blob>()
  let p = 0
  for (let i = 0; i < count; i++) {
    if (central.getUint32(p, true) !== 0x02014b50) {
      throw new Error('ZIP の中央ディレクトリが壊れています')
    }
    const method = central.getUint16(p + 10, true)
    const compSize = central.getUint32(p + 20, true)
    const nameLen = central.getUint16(p + 28, true)
    const extraLen = central.getUint16(p + 30, true)
    const commentLen = central.getUint16(p + 32, true)
    const localOffset = central.getUint32(p + 42, true)
    const name = decoder.decode(
      new Uint8Array(central.buffer, central.byteOffset + p + 46, nameLen),
    )
    p += 46 + nameLen + extraLen + commentLen
    if (name.endsWith('/')) continue

    // ローカルヘッダの可変長は中央ディレクトリと一致しないことがあるので、必ず読み直す。
    const head = new DataView(await file.slice(localOffset, localOffset + 30).arrayBuffer())
    const start = localOffset + 30 + head.getUint16(26, true) + head.getUint16(28, true)
    const raw = file.slice(start, start + compSize)
    out.set(name, method === 0 ? raw : await inflateRaw(raw))
  }
  return out
}
