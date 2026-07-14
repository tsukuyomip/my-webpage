// Pitch-preserving time-stretch via WSOLA (Waveform Similarity Overlap-Add).
//
// Given a mono channel and a stretch factor `alpha` (output length / input
// length), produce a new channel of ~alpha× the duration at the same pitch.
// alpha < 1 speeds the audio up (shorter), alpha > 1 slows it down (longer).
//
// WSOLA advances through the input in analysis hops, but before each overlap-add
// it searches a small neighbourhood for the frame that best continues the
// previously written output — this preserves local waveform periodicity and
// avoids the phasiness of naive overlap-add.

const FRAME = 2048 // analysis/synthesis window size (samples)
const SYNTH_HOP = FRAME >> 1 // 50% overlap
const SEARCH = 360 // ± tolerance (samples) for similarity search
const SEARCH_STEP = 6 // search stride — coarse search keeps it fast
const CORR_STRIDE = 4 // subsample the correlation for speed

function hann(size: number): Float32Array {
  const w = new Float32Array(size)
  for (let i = 0; i < size; i++) w[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (size - 1))
  return w
}

const WINDOW = hann(FRAME)

/**
 * Time-stretch a single channel by `alpha` (output/input duration ratio).
 * Returns a new Float32Array. alpha≈1 short-circuits to a copy.
 */
export function timeStretchChannel(input: Float32Array, alpha: number): Float32Array {
  if (!isFinite(alpha) || alpha <= 0) return input.slice()
  if (Math.abs(alpha - 1) < 1e-3 || input.length < FRAME * 2) return input.slice()

  const analysisHop = Math.max(1, SYNTH_HOP / alpha)
  const outLen = Math.max(FRAME, Math.round(input.length * alpha))
  const out = new Float32Array(outLen + FRAME)
  const norm = new Float32Array(outLen + FRAME)
  const overlap = FRAME - SYNTH_HOP // = SYNTH_HOP for 50%

  let analysisPos = 0 // float, where in the input this frame nominally starts
  let outPos = 0

  // The "natural continuation" of the last written frame in the input: used as
  // the reference the similarity search tries to match.
  let naturalPos = 0

  // Copy the first frame verbatim so there is a tail to match against.
  {
    const start = 0
    for (let i = 0; i < FRAME; i++) {
      const s = input[start + i] ?? 0
      out[i] += s * WINDOW[i]
      norm[i] += WINDOW[i]
    }
    outPos += SYNTH_HOP
    naturalPos = start + SYNTH_HOP
    analysisPos += analysisHop
  }

  while (outPos + FRAME < outLen) {
    // Search around analysisPos for the frame best matching the overlap tail of
    // what naturalPos points to (waveform-similarity criterion).
    let bestOffset = 0
    let bestScore = -Infinity
    const center = Math.round(analysisPos)
    for (let off = -SEARCH; off <= SEARCH; off += SEARCH_STEP) {
      const cand = center + off
      if (cand < 0 || cand + overlap >= input.length) continue
      let score = 0
      for (let i = 0; i < overlap; i += CORR_STRIDE) {
        score += input[cand + i] * input[naturalPos + i]
      }
      if (score > bestScore) {
        bestScore = score
        bestOffset = off
      }
    }
    const frameStart = center + bestOffset
    if (frameStart < 0 || frameStart + FRAME >= input.length) break

    for (let i = 0; i < FRAME; i++) {
      out[outPos + i] += input[frameStart + i] * WINDOW[i]
      norm[outPos + i] += WINDOW[i]
    }

    outPos += SYNTH_HOP
    naturalPos = frameStart + SYNTH_HOP
    analysisPos += analysisHop
  }

  // Normalise the overlap-add so amplitude stays consistent.
  const result = new Float32Array(outLen)
  for (let i = 0; i < outLen; i++) {
    result[i] = norm[i] > 1e-6 ? out[i] / norm[i] : out[i]
  }
  return result
}
