/**
 * 効果音。音声ファイルは持たず、起動時に波形を合成して AudioBuffer にする。
 * 再生は buffer を鳴らすだけなので遅延が小さい（音ゲーではここが効く）。
 *
 * 音作りの方針: 高い音を「持続する正弦波の重ね合わせ」で作ると、
 * どんなに倍音比をずらしても鉦や鈴のように鳴って間が抜ける。
 * 明るさは必ず「ノイズをバンドパスに通したもの」で出し、
 * 正弦波は減衰の速い芯（パンチ）にだけ使う。
 */
export type SfxName = 'perfect' | 'great' | 'good' | 'miss' | 'milestone' | 'tick'

/** 効果音のセット。好みが分かれるので設定で選べるようにしている。 */
export type SfxKit = 'impact' | 'tambourine'

export const SFX_KITS: { id: SfxKit; label: string }[] = [
  { id: 'impact', label: 'ヒット（ビシッ）' },
  { id: 'tambourine', label: 'タンバリン（シャン）' },
]

export const DEFAULT_SFX_KIT: SfxKit = 'impact'

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
  const fade = Math.min(len, Math.round(sr * 0.005))
  for (let i = 0; i < fade; i += 1) data[len - 1 - i] *= i / fade
  return buffer
}

/** 一次ハイパス。 */
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

/** 一次ローパス。 */
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
 * 二次バンドパス（RBJ）。ノイズに通すと、音程を持たないまま
 * その帯域だけが際立つ。金属質の明るさはこれで作る。
 */
function bandPass(sr: number, freq: number, q: number): (x: number) => number {
  const w0 = (TAU * Math.min(freq, sr * 0.45)) / sr
  const alpha = Math.sin(w0) / (2 * q)
  const cos = Math.cos(w0)
  const a0 = 1 + alpha
  const b0 = alpha / a0
  const b2 = -alpha / a0
  const a1 = (-2 * cos) / a0
  const a2 = (1 - alpha) / a0
  let x1 = 0
  let x2 = 0
  let y1 = 0
  let y2 = 0
  return (x) => {
    const y = b0 * x + b2 * x2 - a1 * y1 - a2 * y2
    x2 = x1
    x1 = x
    y2 = y1
    y1 = y
    return y
  }
}

/** 位相を積み上げる正弦波。周波数を動かしても波形が崩れない。 */
function sweep(sr: number, freqAt: (t: number) => number): (t: number) => number {
  let phase = 0
  return (t) => {
    phase += (TAU * freqAt(t)) / sr
    return Math.sin(phase)
  }
}

const exp = (t: number, d: number) => Math.exp(-t / d)

// ---------------------------------------------------------------- ヒット

/**
 * 格ゲーの当たり音のような「ビシッ」。
 * 極端に速い立ち上がり + 短い肉 + すぐ消える芯。余韻は作らない。
 */
function impactHit(
  sr: number,
  opts: { edge: number; edgeDecay: number; crunch: number; punch: number; low: number },
): (t: number) => number {
  const edge = bandPass(sr, 6800, 2.4)
  const crunch = bandPass(sr, 1500, 1.1)
  const body = sweep(sr, (t) => opts.low + 240 * exp(t, 0.011))
  return (t) => {
    const n = noise()
    // 芯の当たり。ここが遅いと「ビシッ」にならない。
    const crack = n * exp(t, 0.0045) * 1.3
    const shine = edge(n) * exp(t, opts.edgeDecay) * opts.edge
    const meat = crunch(n) * exp(t, 0.04) * opts.crunch
    const punch = body(t) * exp(t, 0.05) * opts.punch
    return crack + shine + meat + punch
  }
}

function buildImpactKit(ctx: BaseAudioContext): Record<SfxName, AudioBuffer> {
  return {
    perfect: renderBuffer(ctx, 0.22, 1, (sr) =>
      impactHit(sr, { edge: 0.95, edgeDecay: 0.028, crunch: 0.6, punch: 0.85, low: 95 }),
    ),
    great: renderBuffer(ctx, 0.19, 0.95, (sr) =>
      impactHit(sr, { edge: 0.55, edgeDecay: 0.018, crunch: 0.7, punch: 0.85, low: 82 }),
    ),
    good: renderBuffer(ctx, 0.16, 0.86, (sr) =>
      impactHit(sr, { edge: 0.18, edgeDecay: 0.012, crunch: 0.75, punch: 0.9, low: 70 }),
    ),
    miss: renderBuffer(ctx, 0.26, 0.8, (sr) => {
      const thud = lowPass(sr, 380)
      const dirt = lowPass(sr, 1100)
      const body = sweep(sr, () => 124)
      return (t) => thud(noise()) * exp(t, 0.045) * 1.6 +
        dirt(noise()) * exp(t, 0.01) * 0.45 +
        body(t) * exp(t, 0.09) * 0.9
    }),
    // 節目は重い一撃 + 抜けていく高域。
    milestone: renderBuffer(ctx, 0.7, 1, (sr) => {
      const slam = impactHit(sr, { edge: 1, edgeDecay: 0.05, crunch: 0.9, punch: 1.1, low: 70 })
      const rise = bandPass(sr, 5200, 1.6)
      const sub = sweep(sr, (t) => 60 + 40 * exp(t, 0.2))
      return (t) => slam(t) + rise(noise()) * exp(t, 0.22) * 0.5 + sub(t) * exp(t, 0.25) * 0.5
    }),
    tick: renderBuffer(ctx, 0.04, 0.5, (sr) => {
      const air = highPass(sr, 2600)
      return (t) => air(noise()) * exp(t, 0.005)
    }),
  }
}

// ---------------------------------------------------------------- タンバリン

/**
 * タンバリンの「シャン！」。細かい鈴が一斉に鳴って乾いて消える音なので、
 * 音程のある成分は入れず、帯域を絞ったノイズだけで作る。
 * 鈴が同時に当たらないことが乾いた粒立ちを生むので、数 ms ずらした
 * 粒を重ねる。
 */
const JINGLE_OFFSETS = [
  { at: 0, amp: 1 },
  { at: 0.0015, amp: 0.8 },
  { at: 0.0034, amp: 0.62 },
  { at: 0.006, amp: 0.48 },
  { at: 0.0095, amp: 0.36 },
]

function tambourineHit(
  sr: number,
  opts: { decay: number; bright: number; skin: number },
): (t: number) => number {
  // 広めのバンドパスを重ねて色をつける。Q を上げすぎると鈴＝音程になる。
  const bands = [
    { f: bandPass(sr, 5200, 2.2), a: 1 },
    { f: bandPass(sr, 7400, 2.6), a: 0.9 * opts.bright },
    { f: bandPass(sr, 9800, 3), a: 0.7 * opts.bright },
  ]
  const skin = lowPass(sr, 700)
  return (t) => {
    // ずらして当たる鈴。粒が立って「シャッ」と乾く。
    // 最初の 1 粒をいちばん強くしないと、頭がぼやけて拍から遅れて聞こえる。
    let grains = 0
    for (const g of JINGLE_OFFSETS) {
      if (t < g.at) continue
      grains += noise() * exp(t - g.at, opts.decay) * g.amp
    }
    let out = 0
    for (const b of bands) out += b.f(grains) * b.a
    // 枠を叩く音と、当たった瞬間を立てる短いノイズ。
    return out * 0.9 + skin(noise()) * exp(t, 0.009) * opts.skin + noise() * exp(t, 0.0035) * 0.9
  }
}

function buildTambourineKit(ctx: BaseAudioContext): Record<SfxName, AudioBuffer> {
  return {
    perfect: renderBuffer(ctx, 0.26, 1, (sr) =>
      tambourineHit(sr, { decay: 0.075, bright: 1, skin: 0.7 }),
    ),
    great: renderBuffer(ctx, 0.2, 0.95, (sr) =>
      tambourineHit(sr, { decay: 0.05, bright: 0.75, skin: 0.75 }),
    ),
    good: renderBuffer(ctx, 0.15, 0.86, (sr) =>
      tambourineHit(sr, { decay: 0.03, bright: 0.45, skin: 0.85 }),
    ),
    miss: renderBuffer(ctx, 0.24, 0.78, (sr) => {
      const thud = lowPass(sr, 420)
      const body = sweep(sr, () => 140)
      return (t) => thud(noise()) * exp(t, 0.04) * 1.7 + body(t) * exp(t, 0.075) * 0.85
    }),
    // 節目は短く振ったロール。
    milestone: renderBuffer(ctx, 0.75, 1, (sr) => {
      const shake = tambourineHit(sr, { decay: 0.4, bright: 1, skin: 0.4 })
      const accent = bandPass(sr, 8200, 2)
      return (t) => {
        // 振っている感じを出すため、粒の密度を揺らす。
        const flutter = 0.6 + 0.4 * Math.sin(TAU * 19 * t)
        return shake(t) * flutter + accent(noise()) * exp(t, 0.3) * 0.6
      }
    }),
    tick: renderBuffer(ctx, 0.04, 0.5, (sr) => {
      const air = highPass(sr, 3000)
      return (t) => air(noise()) * exp(t, 0.004)
    }),
  }
}

const KIT_BUILDERS: Record<SfxKit, (ctx: BaseAudioContext) => Record<SfxName, AudioBuffer>> = {
  impact: buildImpactKit,
  tambourine: buildTambourineKit,
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
  private kits: Partial<Record<SfxKit, Record<SfxName, AudioBuffer>>> = {}
  private kit: SfxKit = DEFAULT_SFX_KIT
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
      // どちらもすぐ切り替えられるよう、まとめて作っておく（合成は一瞬）。
      for (const id of Object.keys(KIT_BUILDERS) as SfxKit[]) {
        this.kits[id] = KIT_BUILDERS[id](ctx)
      }
      if (ctx.state === 'suspended') void ctx.resume()
    } catch {
      // 音が出せなくてもゲーム自体は動かす。
      this.ctx = null
    }
  }

  setKit(kit: SfxKit): void {
    if (KIT_BUILDERS[kit]) this.kit = kit
  }

  setVolume(v: number): void {
    this.volume = Math.min(1, Math.max(0, v))
    if (this.master) this.master.gain.value = this.volume
  }

  play(name: SfxName): void {
    const buffers = this.kits[this.kit]
    if (!this.ctx || !this.master || !buffers || this.volume <= 0) return
    try {
      const source = this.ctx.createBufferSource()
      source.buffer = buffers[name]
      source.connect(this.master)
      source.start()
    } catch {
      // 再生できなくても無視する。
    }
  }
}

export const sfx = new SfxEngine()
