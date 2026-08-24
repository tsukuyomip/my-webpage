/**
 * YouTube の getCurrentTime() は更新が粗く（数百 ms 単位で階段状に進む）、
 * そのままでは音ゲーの判定・描画には使えない。
 *
 * ここでは「新しい値が来た瞬間だけをアンカーにし、その間は performance.now()
 * で外挿する」補間クロックを作る。ズレは一気に飛ばさず少しずつ吸収するので、
 * ノーツが瞬間移動しない。
 */
export class MediaClock {
  /** アンカー時点の動画時刻（秒）。 */
  private anchorVideo = 0
  /** アンカー時点の performance.now()（ms）。 */
  private anchorPerf = 0
  private rate = 1
  private running = false
  private lastSample = Number.NaN

  /** アンカーを取り直す閾値（秒）。シークやバッファ復帰はここで拾う。 */
  private static readonly RESYNC_THRESHOLD = 0.3
  /** 1 サンプルあたりに吸収するズレの割合。 */
  private static readonly CORRECTION_RATE = 0.15

  reset(videoTime: number): void {
    this.anchorVideo = videoTime
    this.anchorPerf = performance.now()
    this.lastSample = Number.NaN
  }

  start(videoTime: number): void {
    this.reset(videoTime)
    this.running = true
  }

  stop(videoTime: number): void {
    this.running = false
    this.reset(videoTime)
  }

  get isRunning(): boolean {
    return this.running
  }

  setRate(rate: number): void {
    if (rate === this.rate) return
    // レート変更前の時刻を保ってからレートを差し替える。
    this.anchorVideo = this.now()
    this.anchorPerf = performance.now()
    this.rate = rate
  }

  getRate(): number {
    return this.rate
  }

  now(): number {
    if (!this.running) return this.anchorVideo
    return this.anchorVideo + ((performance.now() - this.anchorPerf) / 1000) * this.rate
  }

  /**
   * 毎フレーム player.getCurrentTime() を渡す。
   * 値が変わっていないフレームは「まだ更新が来ていない」だけなので無視する。
   */
  sample(videoTime: number): void {
    if (!Number.isFinite(videoTime)) return
    if (!this.running) {
      this.anchorVideo = videoTime
      this.anchorPerf = performance.now()
      return
    }
    if (videoTime === this.lastSample) return
    this.lastSample = videoTime

    const error = videoTime - this.now()
    if (Math.abs(error) > MediaClock.RESYNC_THRESHOLD) {
      this.reset(videoTime)
      this.lastSample = videoTime
      return
    }
    this.anchorVideo += error * MediaClock.CORRECTION_RATE
  }
}
