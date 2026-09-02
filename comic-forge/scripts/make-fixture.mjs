// 過去版の作品ファイルを 1 つ作って置いておくためのもの。
//
// 下位互換は「移行コードを書いた」だけでは守れない。実際に古い zip を読ませて、
// 読めて・移行できて・描ける、まで見て初めて守られる。版を上げるときは
//   node scripts/make-fixture.mjs <version>
// で当時の zip を作り、fixtures に足す（作ったら二度と書き換えない）。
import { deflateRawSync } from 'node:zlib'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'

const version = Number(process.argv[2] ?? 1)

const CRC = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()
const crc32 = (buf) => {
  let c = 0xffffffff
  for (const b of buf) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

/** store と deflate を混ぜて書く（読む側が両方に対応していることも一緒に見たいので）。 */
function zip(entries) {
  const local = []
  const central = []
  let offset = 0
  for (const [path, body, deflate] of entries) {
    const name = Buffer.from(path, 'utf8')
    const raw = Buffer.isBuffer(body) ? body : Buffer.from(body, 'utf8')
    const data = deflate ? deflateRawSync(raw) : raw
    const head = Buffer.alloc(30 + name.length)
    head.writeUInt32LE(0x04034b50, 0)
    head.writeUInt16LE(20, 4)
    head.writeUInt16LE(0x0800, 6)
    head.writeUInt16LE(deflate ? 8 : 0, 8)
    head.writeUInt32LE(crc32(raw), 14)
    head.writeUInt32LE(data.length, 18)
    head.writeUInt32LE(raw.length, 22)
    head.writeUInt16LE(name.length, 26)
    name.copy(head, 30)
    local.push(head, data)

    const cd = Buffer.alloc(46 + name.length)
    cd.writeUInt32LE(0x02014b50, 0)
    cd.writeUInt16LE(20, 4)
    cd.writeUInt16LE(20, 6)
    cd.writeUInt16LE(0x0800, 8)
    cd.writeUInt16LE(deflate ? 8 : 0, 10)
    cd.writeUInt32LE(crc32(raw), 16)
    cd.writeUInt32LE(data.length, 20)
    cd.writeUInt32LE(raw.length, 24)
    cd.writeUInt16LE(name.length, 28)
    cd.writeUInt32LE(offset, 42)
    name.copy(cd, 46)
    central.push(cd)
    offset += head.length + data.length
  }
  const cdBuf = Buffer.concat(central)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(entries.length, 8)
  end.writeUInt16LE(entries.length, 10)
  end.writeUInt32LE(cdBuf.length, 12)
  end.writeUInt32LE(offset, 16)
  return Buffer.concat([...local, cdBuf, end])
}

// 1×1 の PNG。画素そのものは見ないので、これで足りる。
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
)
const HASH = '0123456789abcdef0123456789abcdef'

const v1 = {
  schemaVersion: 1,
  writtenBy: 'comic-forge fixture',
  meta: { id: 'fixture-v1', title: '固定見本 v1', createdAt: 1756000000000, updatedAt: 1756000000000 },
  page: {
    width: 1200,
    height: 2400,
    background: '#fffdf7',
    margin: { top: 28, right: 28, bottom: 28, left: 28 },
    gutter: 24,
    frame: { width: 5, color: '#111111', radius: 0 },
  },
  layout: {
    kind: 'split',
    dir: 'row',
    ratios: [0.28, 0.22, 0.25, 0.25],
    tilt: [0, 0.12, 0],
    gutter: 30,
    children: [
      { kind: 'leaf', panel: 'p1' },
      {
        kind: 'split',
        dir: 'col',
        ratios: [0.6, 0.4],
        tilt: [-0.08],
        children: [
          { kind: 'leaf', panel: 'p2' },
          { kind: 'leaf', panel: 'p3' },
        ],
      },
      { kind: 'leaf', panel: 'p4' },
      { kind: 'leaf', panel: 'p5' },
    ],
  },
  panels: {
    p1: {
      id: 'p1',
      inset: { top: 0, right: 0, bottom: 0, left: 0 },
      rotate: 0,
      content: { asset: HASH, x: 12, y: -8, scale: 1.4, rotate: 3 },
    },
    p2: { id: 'p2', inset: { top: 6, right: 6, bottom: 6, left: 6 }, rotate: -2 },
    p3: { id: 'p3', inset: { top: 0, right: 0, bottom: 0, left: 0 }, rotate: 0, frame: null },
    p4: { id: 'p4', inset: { top: 0, right: 0, bottom: 0, left: 0 }, rotate: 0, frame: { width: 9, radius: 18 } },
    p5: { id: 'p5', inset: { top: 0, right: 0, bottom: 0, left: 0 }, rotate: 0 },
  },
  balloons: [],
  assets: {
    [HASH]: { hash: HASH, name: 'shot.png', mime: 'image/png', width: 1, height: 1, size: PNG.length, addedAt: 1756000000000 },
  },
}

const docs = { 1: v1 }
const doc = docs[version]
if (!doc) throw new Error(`v${version} の見本がありません`)

const out = join('src', 'lib', '__fixtures__', `project-v${version}.zip`)
writeFileSync(
  out,
  zip([
    ['project.json', JSON.stringify(doc, null, 2), true],
    ['README.txt', 'Comic Forge の作品ファイルです。\n', false],
    [`images/${HASH}.png`, PNG, false],
  ]),
)
console.log(`wrote ${out}`)
