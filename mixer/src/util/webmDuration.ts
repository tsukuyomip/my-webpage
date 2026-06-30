/**
 * Inject a Segment > Info > Duration element into a WebM produced by
 * MediaRecorder.
 *
 * MediaRecorder emits a "live" WebM stream with no Duration (and no Cues), so
 * players report an unknown/Infinite duration, can't seek, and some editors
 * reject the file as corrupt. We know the exact duration we rendered, so we
 * splice a Duration float into the Info master and fix up the affected size
 * fields. This is the well-known "fix-webm-duration" technique, implemented
 * here without external dependencies.
 *
 * Returns a new Blob; on any parsing surprise it returns the input unchanged so
 * export never fails because of this cosmetic fix.
 */

// EBML element IDs, stored with their length-marker bits (matched as raw bytes).
const ID_SEGMENT = [0x18, 0x53, 0x80, 0x67]
const ID_INFO = [0x15, 0x49, 0xa9, 0x66]
const ID_DURATION = [0x44, 0x89]
const ID_TIMECODE_SCALE = [0x2a, 0xd7, 0xb1]

/** Byte length of an EBML vint/id from its first byte (count leading zeros + 1). */
function vintLength(first: number): number {
  for (let len = 1, mask = 0x80; len <= 8; len++, mask >>= 1) {
    if (first & mask) return len
  }
  throw new Error('invalid EBML vint')
}

interface Vint {
  value: number
  length: number
  unknown: boolean
}

/** Read a size vint (marker bit cleared) at `pos`. */
function readVint(buf: Uint8Array, pos: number): Vint {
  const length = vintLength(buf[pos])
  const mask = 0xff >> length
  let value = buf[pos] & mask
  let unknown = value === mask
  for (let i = 1; i < length; i++) {
    if (buf[pos + i] !== 0xff) unknown = false
    value = value * 256 + buf[pos + i]
  }
  return { value, length, unknown }
}

/** Encode a value as a size vint of exactly `length` bytes. */
function encodeVint(value: number, length: number): Uint8Array {
  const out = new Uint8Array(length)
  let v = value
  for (let i = length - 1; i >= 0; i--) {
    out[i] = v & 0xff
    v = Math.floor(v / 256)
  }
  out[0] |= 0x80 >> (length - 1)
  return out
}

/** Smallest vint length (>= min) that can hold `value` without being all-ones. */
function neededVintLength(value: number, min: number): number {
  for (let len = Math.max(1, min); len <= 8; len++) {
    const max = Math.pow(2, 7 * len) - 1
    if (value < max) return len // < max keeps it distinct from "unknown" (all ones)
  }
  return 8
}

function matchId(buf: Uint8Array, pos: number, id: number[]): boolean {
  for (let i = 0; i < id.length; i++) if (buf[pos + i] !== id[i]) return false
  return true
}

interface Header {
  idLength: number
  dataStart: number
  size: number
  sizeStart: number
  sizeLength: number
  unknownSize: boolean
}

function readHeader(buf: Uint8Array, pos: number): Header {
  const idLength = vintLength(buf[pos])
  const sizeStart = pos + idLength
  const v = readVint(buf, sizeStart)
  return {
    idLength,
    sizeStart,
    sizeLength: v.length,
    size: v.value,
    unknownSize: v.unknown,
    dataStart: sizeStart + v.length,
  }
}

/**
 * Find the first child element with `id` directly inside the master spanning
 * [start, end). Returns its absolute offset, or -1.
 */
function findChild(buf: Uint8Array, start: number, end: number, id: number[]): number {
  let pos = start
  while (pos < end && pos < buf.length) {
    if (matchId(buf, pos, id)) return pos
    const h = readHeader(buf, pos)
    if (h.unknownSize) break // can't safely skip an unknown-size child
    pos = h.dataStart + h.size
  }
  return -1
}

export async function fixWebmDuration(blob: Blob, durationSeconds: number): Promise<Blob> {
  if (!(durationSeconds > 0)) return blob
  try {
    const buf = new Uint8Array(await blob.arrayBuffer())

    // Top-level EBML header, then Segment.
    if (!(buf[0] === 0x1a && buf[1] === 0x45 && buf[2] === 0xdf && buf[3] === 0xa3)) {
      return blob
    }
    // Walk top level to the Segment.
    let pos = 0
    let segStart = -1
    while (pos < buf.length) {
      if (matchId(buf, pos, ID_SEGMENT)) {
        segStart = pos
        break
      }
      const h = readHeader(buf, pos)
      if (h.unknownSize) return blob
      pos = h.dataStart + h.size
    }
    if (segStart < 0) return blob

    const seg = readHeader(buf, segStart)
    const segEnd = seg.unknownSize ? buf.length : seg.dataStart + seg.size

    const infoStart = findChild(buf, seg.dataStart, segEnd, ID_INFO)
    if (infoStart < 0) return blob
    const info = readHeader(buf, infoStart)
    if (info.unknownSize) return blob
    const infoEnd = info.dataStart + info.size

    // Already has a Duration? Leave it alone.
    if (findChild(buf, info.dataStart, infoEnd, ID_DURATION) >= 0) return blob

    // TimecodeScale (default 1,000,000 ns per tick) sets the Duration's unit.
    let timecodeScale = 1_000_000
    const tsStart = findChild(buf, info.dataStart, infoEnd, ID_TIMECODE_SCALE)
    if (tsStart >= 0) {
      const tsh = readHeader(buf, tsStart)
      let v = 0
      for (let i = 0; i < tsh.size; i++) v = v * 256 + buf[tsh.dataStart + i]
      if (v > 0) timecodeScale = v
    }

    // Build the Duration element: id(2) + size(0x88 => 8) + float64 BE.
    const durationTicks = (durationSeconds * 1e9) / timecodeScale
    const durEl = new Uint8Array(2 + 1 + 8)
    durEl[0] = ID_DURATION[0]
    durEl[1] = ID_DURATION[1]
    durEl[2] = 0x88 // size vint: length 1, value 8
    new DataView(durEl.buffer).setFloat64(3, durationTicks, false)

    const added = durEl.length

    // New Info size and its vint (keep byte-length if it still fits).
    const newInfoSize = info.size + added
    const newInfoSizeLen = neededVintLength(newInfoSize, info.sizeLength)
    const newInfoSizeBytes = encodeVint(newInfoSize, newInfoSizeLen)
    const infoSizeDelta = newInfoSizeLen - info.sizeLength

    // Assemble edits (apply right-to-left so earlier offsets stay valid):
    //  1) insert the Duration element at the end of Info's data
    //  2) replace Info's size field
    //  3) if the Segment has a definite size, grow it too
    type Edit = { at: number; remove: number; insert: Uint8Array }
    const edits: Edit[] = [
      { at: infoEnd, remove: 0, insert: durEl },
      { at: info.sizeStart, remove: info.sizeLength, insert: newInfoSizeBytes },
    ]
    if (!seg.unknownSize) {
      const newSegSize = seg.size + added + infoSizeDelta
      const newSegSizeLen = neededVintLength(newSegSize, seg.sizeLength)
      edits.push({
        at: seg.sizeStart,
        remove: seg.sizeLength,
        insert: encodeVint(newSegSize, newSegSizeLen),
      })
    }
    edits.sort((a, b) => b.at - a.at)

    // Compute output size and splice.
    let outLen = buf.length
    for (const e of edits) outLen += e.insert.length - e.remove
    const out = new Uint8Array(outLen)

    // Walk the original buffer, copying segments between edit points.
    let srcPos = 0
    let dstPos = 0
    const ascending = edits.slice().sort((a, b) => a.at - b.at)
    for (const e of ascending) {
      const chunk = buf.subarray(srcPos, e.at)
      out.set(chunk, dstPos)
      dstPos += chunk.length
      out.set(e.insert, dstPos)
      dstPos += e.insert.length
      srcPos = e.at + e.remove
    }
    out.set(buf.subarray(srcPos), dstPos)

    return new Blob([out], { type: blob.type })
  } catch {
    return blob
  }
}
