/**
 * 効果音。音声ファイルは持たず、起動時に波形を合成して AudioBuffer にする。
 * 再生は buffer を鳴らすだけなので遅延が小さい（音ゲーではここが効く）。
 */
export type SfxName = 'perfect' | 'great' | 'good' | 'miss' | 'milestone'

function render(
  ctx: BaseAudioContext,
  duration: number,
  fn: (t: number) => number,
): AudioBuffer {
  const sr = ctx.sampleRate
  const len = Math.max(1, Math.ceil(sr * duration))
  const buffer = ctx.createBuffer(1, len, sr)
  const data = buffer.getChannelData(0)
  for (let i = 0; i < len; i += 1) data[i] = fn(i / sr)
  // 末尾を軽くフェードして「プチッ」を防ぐ。
  const fade = Math.min(len, Math.round(sr * 0.006))
  for (let i = 0; i < fade; i += 1) data[len - 1 - i] *= i / fade
  return buffer
}

const TAU = Math.PI * 2

/** 明るいクリック音。判定が良いほど高く、倍音を足す。 */
function click(freq: number, decay: number, noise: number, harmonic: number) {
  return (t: number) => {
    const env = Math.exp(-t / decay)
    const tone =
      Math.sin(TAU * freq * t) * (1 - harmonic) + Math.sin(TAU * freq * 2 * t) * harmonic
    const hiss = (Math.random() * 2 - 1) * Math.exp(-t / (decay * 0.22))
    return (tone * (1 - noise) + hiss * noise) * env * 0.85
  }
}

function buildBuffers(ctx: BaseAudioContext): Record<SfxName, AudioBuffer> {
  return {
    perfect: render(ctx, 0.14, click(1480, 0.042, 0.22, 0.3)),
    great: render(ctx, 0.14, click(1080, 0.05, 0.26, 0.22)),
    good: render(ctx, 0.16, click(760, 0.06, 0.34, 0.1)),
    // 外したときは下がる低い音。
    miss: render(ctx, 0.3, (t) => {
      const env = Math.exp(-t / 0.09)
      const sweep = Math.sin(TAU * (230 - 150 * Math.min(1, t / 0.18)) * t)
      const hiss = (Math.random() * 2 - 1) * Math.exp(-t / 0.02)
      return (sweep * 0.8 + hiss * 0.25) * env * 0.8
    }),
    // コンボの節目に鳴る 2 音のチャイム。
    milestone: render(ctx, 0.42, (t) => {
      const a = Math.sin(TAU * 988 * t) * Math.exp(-t / 0.1)
      const t2 = t - 0.075
      const b = t2 > 0 ? Math.sin(TAU * 1319 * t2) * Math.exp(-t2 / 0.14) : 0
      return (a + b) * 0.5
    }),
  }
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
      master.connect(ctx.destination)
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
