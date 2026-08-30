/*
 * マイクの波形から音の高さを拾い、音符の並びに直す。
 *
 * 検出は McLeod Pitch Method（正規化二乗差関数 NSDF）。自己相関そのままだと
 * 1 オクターブ下を掴みやすいが、NSDF の「最初の十分高いピーク」を採る方式なら
 * それが起きにくい。鼻歌のように倍音が薄い音でも安定する。
 *
 * ライブラリ非依存・ビルド不要。<script> でそのまま読める。
 */
(function (global) {
  'use strict';

  const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

  /** toio と同じ数え方（音番号 0 = C0）に合わせる */
  function noteName(n) {
    if (n >= 128) return '無音';
    return NOTE_NAMES[((n % 12) + 12) % 12] + Math.floor(n / 12);
  }

  /** 周波数 → 音番号（小数のまま）。A5(=MIDI 69) を 440Hz とする */
  function freqToNote(freq) {
    return 69 + 12 * Math.log2(freq / 440);
  }

  function noteToFreq(note) {
    return 440 * Math.pow(2, (note - 69) / 12);
  }

  /** いちばん近い音からのずれ（セント）。±50 に収まる */
  function centsOff(freq) {
    const n = freqToNote(freq);
    return Math.round((n - Math.round(n)) * 100);
  }

  function rmsOf(buf) {
    let s = 0;
    for (let i = 0; i < buf.length; i++) s += buf[i] * buf[i];
    return Math.sqrt(s / buf.length);
  }

  /**
   * 波形から基本周波数を拾う。
   * @param {Float32Array|Array} buf 時間領域の波形（-1〜1）
   * @param {number} sampleRate
   * @param {object} [opt] fmin(既定70) fmax(既定1100) clarity(既定0.9) gate(既定0.01)
   * @returns {{freq:number, clarity:number, rms:number}} 拾えなければ freq=0
   */
  function detect(buf, sampleRate, opt) {
    const o = Object.assign({ fmin: 70, fmax: 1100, clarity: 0.9, gate: 0.01 }, opt || {});
    const n = buf.length;
    const rms = rmsOf(buf);
    if (rms < o.gate) return { freq: 0, clarity: 0, rms };

    const minTau = Math.max(2, Math.floor(sampleRate / o.fmax));
    const maxTau = Math.min(n - 2, Math.ceil(sampleRate / o.fmin));
    if (maxTau <= minTau) return { freq: 0, clarity: 0, rms };

    // NSDF を tau ごとに出す。0 付近は必ず 1 に近くなるので、
    // ピーク探しは「一度負に落ちてから」始める
    const nsdf = new Float32Array(maxTau + 1);
    for (let tau = 0; tau <= maxTau; tau++) {
      let acf = 0, div = 0;
      for (let i = 0; i + tau < n; i++) {
        acf += buf[i] * buf[i + tau];
        div += buf[i] * buf[i] + buf[i + tau] * buf[i + tau];
      }
      nsdf[tau] = div > 0 ? (2 * acf) / div : 0;
    }

    // 負に落ちたあとの山（key maxima）を集める。
    // 飛ばし始めは tau=1 から。minTau から始めると、高い音のときに
    // 本命の山の途中から飛ばし始めてしまい、その山を丸ごと読み落とす
    // （880Hz を 440Hz と誤検出していた原因）
    const peaks = [];
    let tau = 1;
    while (tau <= maxTau && nsdf[tau] > 0) tau++;   // tau=0 付近の山を越える
    while (tau <= maxTau) {
      if (nsdf[tau] > 0) {
        let best = tau;
        while (tau <= maxTau && nsdf[tau] > 0) {
          if (nsdf[tau] > nsdf[best]) best = tau;
          tau++;
        }
        // 山の頂点が探したい音域に入っているものだけ採る
        if (best >= minTau && best > 0 && best < maxTau) peaks.push(best);
      } else {
        tau++;
      }
    }
    if (!peaks.length) return { freq: 0, clarity: 0, rms };

    // いちばん高い山の clarity 倍を超える「最初の」山を採る。
    // ここで最大値そのものを採ると、1 オクターブ下に引きずられる
    let maxVal = 0;
    for (const p of peaks) if (nsdf[p] > maxVal) maxVal = nsdf[p];
    const threshold = maxVal * o.clarity;
    let chosen = peaks[0];
    for (const p of peaks) { if (nsdf[p] >= threshold) { chosen = p; break; } }
    if (nsdf[chosen] < 0.5) return { freq: 0, clarity: nsdf[chosen], rms };

    // 放物線で山の頂点を補間する。そのままだと分解能がサンプル単位で粗い
    const y1 = nsdf[chosen - 1], y2 = nsdf[chosen], y3 = nsdf[chosen + 1];
    const denom = 2 * (2 * y2 - y1 - y3);
    const shift = denom !== 0 ? (y3 - y1) / denom : 0;
    const period = chosen + shift;
    if (!(period > 0)) return { freq: 0, clarity: nsdf[chosen], rms };

    return { freq: sampleRate / period, clarity: nsdf[chosen], rms };
  }

  /**
   * 拾った音を音符の並びにまとめる。
   *
   * 1 フレームごとの検出結果はどうしても揺れるので、
   * **同じ音が続けて何回か出てから**切り替える。これが無いと、
   * 音の立ち上がりや息継ぎのたびに別の音として記録されてしまう。
   */
  class Tracker {
    /**
     * @param {object} [opt]
     *   hold      切り替えに必要な連続回数（既定 3）
     *   minMs     これより短い音は捨てる（既定 80）
     *   onChange  鳴っている音が変わったときに呼ぶ (note|null) => void
     */
    constructor(opt) {
      const o = Object.assign({ hold: 3, minMs: 80, onChange: null }, opt || {});
      this.hold = o.hold;
      this.minMs = o.minMs;
      this.onChange = o.onChange;
      this.log = [];         // {note, startMs, durMs, velocity}
      this.current = null;   // いま鳴っていることになっている音
      this._start = 0;
      this._peak = 0;
      this._cand = null;
      this._count = 0;
    }

    /**
     * @param {{freq:number, clarity:number, rms:number}} d detect() の結果
     * @param {number} tMs 経過時間
     */
    feed(d, tMs) {
      const note = d.freq > 0 ? Math.round(freqToNote(d.freq)) : null;
      const valid = note !== null && note >= 0 && note <= 127;
      const cand = valid ? note : null;

      if (cand === this._cand) this._count++;
      else { this._cand = cand; this._count = 1; }

      if (this.current !== null) this._peak = Math.max(this._peak, d.rms);
      if (this._count < this.hold || cand === this.current) return;

      this._close(tMs);
      this.current = cand;
      this._start = tMs;
      this._peak = d.rms;
      if (this.onChange) this.onChange(cand);
    }

    /** 記録を締める。マイクを止めるときに呼ぶ */
    stop(tMs) {
      // _close() が current を null にするので、鳴っていたかを先に控える
      const wasSounding = this.current !== null;
      this._close(tMs);
      if (wasSounding && this.onChange) this.onChange(null);
      this.current = null;
      this._cand = null;
      this._count = 0;
    }

    _close(tMs) {
      if (this.current === null) return;
      const durMs = tMs - this._start;
      // 短すぎるものは、しゃくり上げや息の音であって狙った音ではない
      if (durMs >= this.minMs) {
        this.log.push({
          note: this.current,
          startMs: this._start,
          durMs,
          // 大きさを MIDI の強さに写す。0.3 でだいたい上限になるくらい
          velocity: Math.max(1, Math.min(127, Math.round(this._peak / 0.3 * 127))),
        });
      }
      this.current = null;
    }

    clear() {
      this.log.length = 0;
      this.current = null;
      this._cand = null;
      this._count = 0;
    }
  }

  global.ToioPitch = { detect, freqToNote, noteToFreq, centsOff, noteName, rmsOf, Tracker };
})(typeof window !== 'undefined' ? window : globalThis);
