// IFrame Player API のうち、このアプリで使う分だけの最小宣言。
// 依存パッケージを増やさないため @types/youtube は入れていない。
declare namespace YT {
  interface PlayerVars {
    autoplay?: 0 | 1
    controls?: 0 | 1
    disablekb?: 0 | 1
    enablejsapi?: 0 | 1
    fs?: 0 | 1
    iv_load_policy?: 1 | 3
    modestbranding?: 0 | 1
    playsinline?: 0 | 1
    rel?: 0 | 1
    origin?: string
  }

  interface PlayerEvent {
    target: Player
  }

  interface OnStateChangeEvent extends PlayerEvent {
    data: number
  }

  interface OnErrorEvent extends PlayerEvent {
    data: number
  }

  interface PlayerOptions {
    videoId?: string
    width?: number | string
    height?: number | string
    playerVars?: PlayerVars
    events?: {
      onReady?: (e: PlayerEvent) => void
      onStateChange?: (e: OnStateChangeEvent) => void
      onError?: (e: OnErrorEvent) => void
    }
  }

  class Player {
    constructor(element: HTMLElement | string, options: PlayerOptions)
    playVideo(): void
    pauseVideo(): void
    stopVideo(): void
    seekTo(seconds: number, allowSeekAhead: boolean): void
    getCurrentTime(): number
    getDuration(): number
    getPlayerState(): number
    getPlaybackRate(): number
    setPlaybackRate(rate: number): void
    getAvailablePlaybackRates(): number[]
    loadVideoById(videoId: string, startSeconds?: number): void
    cueVideoById(videoId: string, startSeconds?: number): void
    setVolume(volume: number): void
    getVolume(): number
    mute(): void
    unMute(): void
    isMuted(): boolean
    getIframe(): HTMLIFrameElement
    destroy(): void
  }

  const PlayerState: {
    UNSTARTED: -1
    ENDED: 0
    PLAYING: 1
    PAUSED: 2
    BUFFERING: 3
    CUED: 5
  }
}

interface Window {
  YT?: typeof YT
  onYouTubeIframeAPIReady?: () => void
}
