// Minimal in-place iterative radix-2 Cooley–Tukey FFT.
// Real input helper included. No external dependencies so it bundles cleanly
// for GitHub Pages.

/** In-place complex FFT. `re`/`im` length must be a power of two. */
export function fft(re: Float32Array, im: Float32Array): void {
  const n = re.length
  if (n <= 1) return
  if ((n & (n - 1)) !== 0) throw new Error('fft length must be a power of two')

  // Bit-reversal permutation.
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1
    for (; j & bit; bit >>= 1) j ^= bit
    j ^= bit
    if (i < j) {
      const tr = re[i]
      re[i] = re[j]
      re[j] = tr
      const ti = im[i]
      im[i] = im[j]
      im[j] = ti
    }
  }

  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len
    const wRe = Math.cos(ang)
    const wIm = Math.sin(ang)
    for (let i = 0; i < n; i += len) {
      let curRe = 1
      let curIm = 0
      const half = len >> 1
      for (let k = 0; k < half; k++) {
        const aRe = re[i + k]
        const aIm = im[i + k]
        const bRe = re[i + k + half]
        const bIm = im[i + k + half]
        const tRe = bRe * curRe - bIm * curIm
        const tIm = bRe * curIm + bIm * curRe
        re[i + k] = aRe + tRe
        im[i + k] = aIm + tIm
        re[i + k + half] = aRe - tRe
        im[i + k + half] = aIm - tIm
        const nextRe = curRe * wRe - curIm * wIm
        curIm = curRe * wIm + curIm * wRe
        curRe = nextRe
      }
    }
  }
}

/** Next power of two >= n. */
export function nextPow2(n: number): number {
  let p = 1
  while (p < n) p <<= 1
  return p
}

/**
 * Magnitude spectrum of a real, windowed frame. Returns the first N/2 bins.
 * `frame` is copied into a power-of-two complex buffer (zero-padded) first.
 */
export function magnitudeSpectrum(frame: Float32Array): Float32Array {
  const n = nextPow2(frame.length)
  const re = new Float32Array(n)
  const im = new Float32Array(n)
  re.set(frame)
  fft(re, im)
  const half = n >> 1
  const mag = new Float32Array(half)
  for (let i = 0; i < half; i++) {
    mag[i] = Math.hypot(re[i], im[i])
  }
  return mag
}
