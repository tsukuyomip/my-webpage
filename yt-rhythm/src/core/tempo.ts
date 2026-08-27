/**
 * タップから BPM を推定する。
 *
 * 1 か所で連打しても、人のばらつき（±30ms 程度）がそのまま誤差になる。
 * **離れた場所でもう一度叩き、その間の拍数を整数に決める**と、長い区間で
 * 割ることになるので誤差が一気に小さくなる。
 *
 * ただし遠すぎるとつなげない。1 拍 0.5 秒を 1% 取り違えていると、30 秒先では
 * 1.5 拍ぶんずれてしまい、何拍空いたのかが決まらない。**間違った拍数で
 * 自信満々にずれた BPM を出すのが最悪**なので、いまの精度で拍数が一意に
 * 決まる距離だけをつなぐ。つなぐたびに精度が上がるので、次はもっと遠くまで
 * 届く。これを近いほうから繰り返して伸ばしていく。
 */

/** これ以上間が空いたら、別の場所を叩いたものとして区切る。 */
export const BURST_GAP_SEC = 2
/** 上下それぞれこの割合を外れ値として捨てる。 */
const TRIM_RATIO = 0.1
/** 拍として認める間隔の範囲（秒）。40〜300 BPM。 */
const MIN_INTERVAL = 60 / 300
const MAX_INTERVAL = 60 / 40
/** 叩き忘れをこの数まで補う（間隔が 2 拍・3 拍ぶんでも拾う）。 */
const MAX_SKIP = 4
/** 「何拍ぶんか」を認めるずれの上限。 */
const SKIP_SLACK = 0.25
/**
 * つなぐときに許す拍数の不確かさ（拍）。0.5 を超えると隣の整数と区別が
 * つかない。手前で止めて、取り違えないようにする。
 */
const LINK_LIMIT = 0.45
/** タップのばらつきぶんの上乗せ（拍）。 */
const LINK_JITTER = 0.12
/** 統計が取れないほど少ないタップのときに仮定するばらつき（秒）。 */
const ASSUMED_JITTER_SEC = 0.025

export interface TempoEstimate {
  bpm: number
  /** 拍の位相（秒）。この時刻ちょうどに拍が来る。 */
  offsetSec: number
  /** 使ったタップ数。 */
  taps: number
  /** 叩いた場所の数。 */
  bursts: number
  /** つなげられた場所の数。bursts より少なければ、離れすぎたものがある。 */
  linked: number
  /** BPM の誤差の目安（±）。 */
  errorBpm: number
  /** いまの精度で、次はどのくらい先まで届くか（秒）。 */
  reachSec: number
}

/** 間が空いた所で区切って、叩いた場所ごとにまとめる。 */
export function splitBursts(times: number[], gapSec = BURST_GAP_SEC): number[][] {
  const sorted = [...times].sort((a, b) => a - b)
  const bursts: number[][] = []
  let current: number[] = []
  for (const t of sorted) {
    if (current.length > 0 && t - current[current.length - 1] > gapSec) {
      bursts.push(current)
      current = []
    }
    current.push(t)
  }
  if (current.length > 0) bursts.push(current)
  return bursts
}

/** 上下を捨てて平均する。捨てすぎないよう、必ず 1 つは残す。 */
export function trimmedMean(values: number[], ratio = TRIM_RATIO): number {
  if (values.length === 0) return Number.NaN
  const sorted = [...values].sort((a, b) => a - b)
  const cut = Math.min(Math.floor(sorted.length * ratio), Math.floor((sorted.length - 1) / 2))
  const kept = sorted.slice(cut, sorted.length - cut)
  return kept.reduce((a, b) => a + b, 0) / kept.length
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b)
  const mid = sorted.length >> 1
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

/**
 * ざっくりした 1 拍の長さ。叩き忘れて 2 拍ぶん空いた間隔は 2 で割って拾う
 * （人はよく飛ばす）。何拍ぶんとも読めない間隔は押し間違いとして捨てる。
 */
function coarsePeriod(bursts: number[][]): number | null {
  const raw: number[] = []
  for (const burst of bursts) {
    for (let i = 1; i < burst.length; i += 1) {
      const gap = burst[i] - burst[i - 1]
      if (gap >= MIN_INTERVAL && gap <= MAX_INTERVAL) raw.push(gap)
    }
  }
  if (raw.length === 0) return null
  const base = median(raw)
  const beats: number[] = []
  for (const gap of raw) {
    const k = Math.min(MAX_SKIP, Math.max(1, Math.round(gap / base)))
    if (Math.abs(gap / (base * k) - 1) <= SKIP_SLACK) beats.push(gap / k)
  }
  if (beats.length === 0) return null
  const period = trimmedMean(beats)
  return period >= MIN_INTERVAL && period <= MAX_INTERVAL ? period : null
}

interface Fit {
  period: number
  offset: number
  /** 1 拍の長さの不確かさ（秒, 1σ）。 */
  periodSigma: number
  /** 位相の不確かさ（秒, 1σ）。 */
  offsetSigma: number
}

/** t = offset + n * period の最小二乗あてはめと、その不確かさ。 */
function fit(times: number[], beats: number[]): Fit | null {
  const n = times.length
  if (n < 2) return null
  const tBar = times.reduce((a, b) => a + b, 0) / n
  const nBar = beats.reduce((a, b) => a + b, 0) / n
  let num = 0
  let den = 0
  for (let i = 0; i < n; i += 1) {
    num += (beats[i] - nBar) * (times[i] - tBar)
    den += (beats[i] - nBar) ** 2
  }
  if (den <= 0) return null
  const period = num / den
  const offset = tBar - period * nBar
  // 残差から誤差を出す。点が少なくて統計にならないうちは、人のばらつきを仮定する。
  let sumSq = 0
  for (let i = 0; i < n; i += 1) sumSq += (times[i] - (offset + beats[i] * period)) ** 2
  const resid = n > 3 ? Math.sqrt(sumSq / (n - 2)) : ASSUMED_JITTER_SEC
  const safe = Math.max(resid, ASSUMED_JITTER_SEC * 0.2)
  return {
    period,
    offset,
    periodSigma: safe / Math.sqrt(den),
    offsetSigma: safe * Math.sqrt(1 / n + (nBar * nBar) / den),
  }
}

/**
 * 外れ値を捨ててからあてはめ直す。指が滑った 1 発が全体を引っぱると、
 * BPM も「どこまで届くか」も一緒に悪くなるので、明らかに浮いた点は落とす。
 * 落とすのは全体の 2 割まで（そこまで外れていたら叩き方の問題）。
 */
function robustFit(times: number[], beats: number[]): Fit | null {
  const first = fit(times, beats)
  if (!first || times.length < 5) return first
  const resid = times.map((t, i) => t - (first.offset + beats[i] * first.period))
  // ばらつきは中央絶対偏差で見る。標準偏差だと外れ値自身がしきい値を広げてしまい、
  // 落としたいものほど落ちなくなる。
  const mad = median(resid.map((r) => Math.abs(r - median(resid))))
  const sigma = mad * 1.4826
  const limit = Math.max(3 * sigma, ASSUMED_JITTER_SEC * 1.5)
  const keep = times.map((_, i) => Math.abs(resid[i]) <= limit)
  const dropped = keep.filter((k) => !k).length
  if (dropped === 0 || dropped > times.length * 0.2) return first
  const second = fit(times.filter((_, i) => keep[i]), beats.filter((_, i) => keep[i]))
  return second ?? first
}

/** いまの精度で、拍数を取り違えずに届く距離（秒）。 */
function reach(state: Fit): number {
  const budget = LINK_LIMIT - LINK_JITTER - (3 * state.offsetSigma) / state.period
  if (budget <= 0) return 0
  // 3σ で見たときの拍数のずれが budget を超えない距離。
  return (budget * state.period * state.period) / (3 * state.periodSigma)
}

/**
 * タップ時刻（秒）から BPM を推定する。3 回以上叩いていないと出せない。
 * 近い場所から順につないでいき、拍数が一意に決まらない距離は残す。
 */
export function estimateTempo(times: number[]): TempoEstimate | null {
  const bursts = splitBursts(times).filter((b) => b.length >= 2)
  const base = coarsePeriod(bursts)
  if (base === null) return null

  // バースト内の拍番号は、ざっくりした 1 拍で丸めれば十分決まる。
  const labeled = bursts.map((burst) => ({
    times: burst,
    beats: burst.map((t) => Math.round((t - burst[0]) / base)),
  }))
  // いちばん長く叩いた所を起点にする。そこがいちばん確かなので。
  const startIndex = labeled.reduce((best, b, i) => (b.times.length > labeled[best].times.length ? i : best), 0)
  const start = labeled[startIndex]
  let state = robustFit(start.times, start.beats)
  if (!state) return null

  let usedTimes = [...start.times]
  let usedBeats = [...start.beats]
  const pending = labeled.filter((_, i) => i !== startIndex)
  let linked = 1

  for (;;) {
    const span = { from: Math.min(...usedTimes), to: Math.max(...usedTimes) }
    // 近いものから順に試す。1 つつなぐたびに精度が上がり、次はもっと遠くへ届く。
    pending.sort((a, b) => distanceTo(span, a.times) - distanceTo(span, b.times))
    const next = pending[0]
    if (!next) break
    const distance = distanceTo(span, next.times)
    if (distance > reach(state)) break

    // 起点と同じ拍番号のふり方に直してからつなぐ。
    const anchor = next.times[0]
    const anchorBeat = Math.round((anchor - state.offset) / state.period)
    const beats = next.beats.map((n) => n + anchorBeat)
    const merged = robustFit([...usedTimes, ...next.times], [...usedBeats, ...beats])
    if (!merged || Math.abs(merged.period / base - 1) > 0.15) break
    // 念のため、つないだ結果が拍に乗っているかを見る。
    const worst = Math.max(
      ...next.times.map((t, i) => Math.abs((t - merged.offset) / merged.period - beats[i])),
    )
    if (worst > 0.3) break

    usedTimes = [...usedTimes, ...next.times]
    usedBeats = [...usedBeats, ...beats]
    state = merged
    linked += 1
    pending.splice(0, 1)
  }

  if (usedTimes.length < 3) return null
  const bpm = 60 / state.period
  return {
    bpm,
    // 位相は最初の拍に寄せる（負の時刻にしない）。
    offsetSec: state.offset - Math.floor(state.offset / state.period) * state.period,
    taps: usedTimes.length,
    bursts: bursts.length,
    linked,
    // 1 拍の誤差 → BPM の誤差。2σ でだいたいの幅として見せる。
    errorBpm: (2 * state.periodSigma * bpm) / state.period,
    reachSec: reach(state),
  }
}

function distanceTo(span: { from: number; to: number }, times: number[]): number {
  const from = Math.min(...times)
  const to = Math.max(...times)
  if (to < span.from) return span.from - to
  if (from > span.to) return from - span.to
  return 0
}
