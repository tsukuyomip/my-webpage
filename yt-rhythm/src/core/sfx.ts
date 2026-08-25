/**
 * 効果音。音声ファイルは持たず、起動時に波形を合成して AudioBuffer にする。
 * 再生は buffer を鳴らすだけなので遅延が小さい（音ゲーではここが効く）。
 *
 * 音作りの方針: 判定音は「バシッ」という立ち上がりと「シャーン」という
 * 金属質の余韻を重ねる。単純な正弦波のピンポンだと軽くて手応えが出ない。
 */
export type SfxName = 'perfect' | 'great' | 'good' | 'miss' | 'milestone' | 'tick'

const TAU = Math.PI * 2

function noise(): number {
  return Math.random() * 2 - 1
}

/**
 * 波形を 1 サンプルずつ作る。make が返す関数は先頭から順に呼ばれるので、
 * フィルタの状態はクロージャに持てる。
 * 作った波形はピーク 1 に正規化してから gain を掛ける（音量差を意図どおりにする）。
 */
function renderBuffer(
  ctx: BaseAudioContext,
  duration: number,
  gain: number,
  make: (sr: number) => (t: number) => number,
): AudioBuffer {
  const sr = ctx.sampleRate
  const len = Math.max(1, Math.ceil(sr * duration))
  const buffer = ctx.createBuffer(1, len, sr)
  const data = buffer.getChannelData(0)
  const step = make(sr)
  let peak = 0
  for (let i = 0; i < len; i += 1) {
    const v = step(i / sr)
    data[i] = v
    const abs = Math.abs(v)
    if (abs > peak) peak = abs
  }
  const scale = (peak > 0 ? 1 / peak : 1) * gain
  for (let i = 0; i < len; i += 1) data[i] *= scale
  // 末尾を軽くフェードして「プチッ」を防ぐ。
  const fade = Math.min(len, Math.round(sr * 0.006))
  for (let i = 0; i < fade; i += 1) data[len - 1 - i] *= i / fade
  return buffer
}

/** 一次ハイパス。ノイズから低い成分を抜いて、空気感だけ残す。 */
function highPass(sr: number, cutoff: number): (x: number) => number {
  const rc = 1 / (TAU * cutoff)
  const a = rc / (rc + 1 / sr)
  let prevIn = 0
  let prevOut = 0
  return (x) => {
    const y = a * (prevOut + x - prevIn)
    prevIn = x
    prevOut = y
    return y
  }
}

/** 一次ローパス。耳に刺さる帯域を丸める。 */
function lowPass(sr: number, cutoff: number): (x: number) => number {
  const rc = 1 / (TAU * cutoff)
  const a = (1 / sr) / (rc + 1 / sr)
  let prev = 0
  return (x) => {
    prev += a * (x - prev)
    return prev
  }
}

/**
 * 非整数倍の倍音を重ねた金属音。整数倍だと楽器の音になってしまうので、
 * わざと割り切れない比を使う（シンバルや鈴の作り方）。
 */
const METAL_RATIOS = [1, 1.447, 1.617, 1.927, 2.503, 2.664, 3.417]

function metalCluster(f0: number, decay: number): (t: number) => number {
  const parts = METAL_RATIOS.map((ratio, i) => ({
    // わずかにずらすと、重なったときに濁らずに広がる。
    freq: f0 * ratio * (1 + (Math.random() - 0.5) * 0.03),
    decay: decay / (1 + i * 0.3),
    amp: 1 / (1 + i * 0.5),
  }))
  return (t) => {
    let sum = 0
    for (const p of parts) sum += Math.sin(TAU * p.freq * t) * Math.exp(-t / p.decay) * p.amp
    return sum
  }
}

function buildBuffers(ctx: BaseAudioContext): Record<SfxName, AudioBuffer> {
  return {
    // いちばん気持ちよく。鋭い立ち上がり + 明るい金属の余韻 + 芯。
    perfect: renderBuffer(ctx, 0.42, 1, (sr) => {
      const air = highPass(sr, 4200)
      const ring = metalCluster(1420, 0.3)
      return (t) => {
        const snap = air(noise()) * Math.exp(-t / 0.013) * 1.4
        // シャンシャンした揺れ。一定に減衰するだけだと鈴にならない。
        const shimmer = air(noise()) * Math.exp(-t / 0.2) * (0.6 + 0.4 * Math.sin(TAU * 47 * t)) * 0.5
        const body = Math.sin(TAU * 520 * t) * Math.exp(-t / 0.028) * 0.8
        return snap + shimmer + ring(t) * 0.5 + body
      }
    }),
    // PERFECT を少し落ち着かせたもの。余韻を短く、芯を低く。
    great: renderBuffer(ctx, 0.3, 0.94, (sr) => {
      const air = highPass(sr, 3200)
      const ring = metalCluster(1080, 0.17)
      return (t) => {
        const snap = air(noise()) * Math.exp(-t / 0.011) * 1.2
        const shimmer = air(noise()) * Math.exp(-t / 0.1) * 0.3
        const body = Math.sin(TAU * 430 * t) * Math.exp(-t / 0.03) * 0.85
        return snap + shimmer + ring(t) * 0.4 + body
      }
    }),
    // 拾えたことは分かるが、うれしくはない音。金属の余韻はほぼ無し。
    good: renderBuffer(ctx, 0.2, 0.85, (sr) => {
      const air = highPass(sr, 1800)
      const soft = lowPass(sr, 2600)
      const ring = metalCluster(760, 0.07)
      return (t) => {
        const snap = soft(air(noise())) * Math.exp(-t / 0.014) * 1.1
        const body = Math.sin(TAU * 330 * t) * Math.exp(-t / 0.035) * 0.9
        return snap + ring(t) * 0.22 + body
      }
    }),
    // 外したときは低く詰まった音。下降スイープは間が抜けるので使わない。
    miss: renderBuffer(ctx, 0.32, 0.8, (sr) => {
      const thud = lowPass(sr, 420)
      const dirt = lowPass(sr, 1400)
      return (t) => {
        const hit = thud(noise()) * Math.exp(-t / 0.05) * 1.6
        const tsk = dirt(noise()) * Math.exp(-t / 0.012) * 0.5
        const body = Math.sin(TAU * 132 * t) * Math.exp(-t / 0.11) * 0.9
        return hit + tsk + body
      }
    }),
    // コンボの節目。金属を 2 段重ねて派手に伸ばす。
    milestone: renderBuffer(ctx, 0.9, 1, (sr) => {
      const air = highPass(sr, 5000)
      const low = metalCluster(880, 0.55)
      const high = metalCluster(1760, 0.4)
      return (t) => {
        const crash = air(noise()) * Math.exp(-t / 0.32) * (0.55 + 0.45 * Math.sin(TAU * 33 * t)) * 0.9
        const second = t > 0.08 ? high(t - 0.08) * 0.45 : 0
        return crash + low(t) * 0.5 + second
      }
    }),
    // エディタの打ち込み確認用。余韻があるとノーツが詰まったとき濁るので、
    // 判定音とは別に短いクリックを用意する。
    tick: renderBuffer(ctx, 0.05, 0.55, (sr) => {
      const air = highPass(sr, 2600)
      return (t) => air(noise()) * Math.exp(-t / 0.006) + Math.sin(TAU * 1900 * t) * Math.exp(-t / 0.007)
    }),
  }
}

/**
 * 音が重なったときに歪まないよう、出口で軽く潰す。
 * コンプレッサだと数 ms 遅れるので、遅延ゼロの波形整形を使う。
 */
function softClipCurve(): Float32Array {
  const n = 1024
  const curve = new Float32Array(n)
  const k = 1.7
  for (let i = 0; i < n; i += 1) {
    const x = (i / (n - 1)) * 2 - 1
    curve[i] = Math.tanh(x * k) / Math.tanh(k)
  }
  return curve
}

class SfxEngine {
  private ctx: AudioContext | null = null
  private master: GainNode | null = null
  private buffers: Record<SfxName, AudioBuffer> | null = null
  private volume = 0.7

  /** ユーザー操作の中から呼ぶこと（iOS などは操作なしに音を出せない）。 */
  ensure(): void {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume()
      return
    }
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!Ctor) return
    try {
      const ctx = new Ctor()
      const master = ctx.createGain()
      master.gain.value = this.volume
      const shaper = ctx.createWaveShaper()
      shaper.curve = softClipCurve()
      master.connect(shaper)
      shaper.connect(ctx.destination)
      this.ctx = ctx
      this.master = master
      this.buffers = buildBuffers(ctx)
      if (ctx.state === 'suspended') void ctx.resume()
    } catch {
      // 音が出せなくてもゲーム自体は動かす。
      this.ctx = null
    }
  }

  setVolume(v: number): void {
    this.volume = Math.min(1, Math.max(0, v))
    if (this.master) this.master.gain.value = this.volume
  }

  play(name: SfxName): void {
    if (!this.ctx || !this.master || !this.buffers || this.volume <= 0) return
    try {
      const source = this.ctx.createBufferSource()
      source.buffer = this.buffers[name]
      source.connect(this.master)
      source.start()
    } catch {
      // 再生できなくても無視する。
    }
  }
}

export const sfx = new SfxEngine()
