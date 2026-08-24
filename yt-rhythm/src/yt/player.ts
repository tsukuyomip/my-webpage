/// <reference path="./youtube.d.ts" />

export type PlayerStateName =
  | 'unstarted'
  | 'ended'
  | 'playing'
  | 'paused'
  | 'buffering'
  | 'cued'

const STATE_NAMES: Record<number, PlayerStateName> = {
  [-1]: 'unstarted',
  0: 'ended',
  1: 'playing',
  2: 'paused',
  3: 'buffering',
  5: 'cued',
}

/** 埋め込み再生できないときにユーザーに見せる説明。 */
const ERROR_MESSAGES: Record<number, string> = {
  2: '動画 ID が不正です。URL を確認してください。',
  5: 'この動画は HTML5 プレイヤーで再生できません。',
  100: '動画が見つかりません（削除済み、または非公開）。',
  101: 'この動画は埋め込み再生が許可されていません。',
  150: 'この動画は埋め込み再生が許可されていません。',
}

let apiPromise: Promise<void> | null = null

/** IFrame Player API を一度だけ読み込む。 */
export function loadYouTubeApi(): Promise<void> {
  if (apiPromise) return apiPromise
  apiPromise = new Promise<void>((resolve, reject) => {
    if (window.YT?.Player) {
      resolve()
      return
    }
    const prev = window.onYouTubeIframeAPIReady
    window.onYouTubeIframeAPIReady = () => {
      prev?.()
      resolve()
    }
    const script = document.createElement('script')
    script.src = 'https://www.youtube.com/iframe_api'
    script.async = true
    script.onerror = () =>
      reject(new Error('YouTube プレイヤーの読み込みに失敗しました。通信環境を確認してください。'))
    document.head.appendChild(script)
  })
  return apiPromise
}

/**
 * URL でも ID でも受け取って動画 ID を取り出す。
 * 対応: youtu.be/xxxx, /watch?v=xxxx, /embed/xxxx, /shorts/xxxx, 生の ID
 */
export function extractVideoId(input: string): string | null {
  const text = input.trim()
  if (!text) return null
  if (/^[\w-]{11}$/.test(text)) return text
  let url: URL
  try {
    url = new URL(text.startsWith('http') ? text : `https://${text}`)
  } catch {
    return null
  }
  const host = url.hostname.replace(/^www\./, '')
  if (host === 'youtu.be') {
    const id = url.pathname.slice(1).split('/')[0]
    return /^[\w-]{11}$/.test(id) ? id : null
  }
  if (host.endsWith('youtube.com') || host.endsWith('youtube-nocookie.com')) {
    const v = url.searchParams.get('v')
    if (v && /^[\w-]{11}$/.test(v)) return v
    const m = url.pathname.match(/\/(embed|shorts|v|live)\/([\w-]{11})/)
    if (m) return m[2]
  }
  return null
}

export interface PlayerCallbacks {
  onStateChange?: (state: PlayerStateName) => void
  onError?: (message: string) => void
}

export class VideoPlayer {
  private player: YT.Player | null = null
  private ready = false
  state: PlayerStateName = 'unstarted'

  constructor(private readonly callbacks: PlayerCallbacks = {}) {}

  /** container の中にプレイヤー用の div を作って埋め込む。 */
  async mount(container: HTMLElement, videoId: string): Promise<void> {
    await loadYouTubeApi()
    const host = document.createElement('div')
    container.appendChild(host)

    await new Promise<void>((resolve) => {
      this.player = new window.YT!.Player(host, {
        videoId,
        width: '100%',
        height: '100%',
        playerVars: {
          autoplay: 0,
          controls: 0,
          disablekb: 1,
          fs: 0,
          iv_load_policy: 3,
          modestbranding: 1,
          playsinline: 1,
          rel: 0,
          origin: window.location.origin,
        },
        events: {
          onReady: () => {
            this.ready = true
            resolve()
          },
          onStateChange: (e) => {
            this.state = STATE_NAMES[e.data] ?? 'unstarted'
            this.callbacks.onStateChange?.(this.state)
          },
          onError: (e) => {
            this.callbacks.onError?.(
              ERROR_MESSAGES[e.data] ?? `プレイヤーでエラーが発生しました (code ${e.data})。`,
            )
          },
        },
      })
    })
  }

  get isReady(): boolean {
    return this.ready && this.player !== null
  }

  get iframe(): HTMLIFrameElement | null {
    try {
      return this.player?.getIframe() ?? null
    } catch {
      return null
    }
  }

  play(): void {
    this.player?.playVideo()
  }

  pause(): void {
    this.player?.pauseVideo()
  }

  seek(seconds: number): void {
    this.player?.seekTo(Math.max(0, seconds), true)
  }

  load(videoId: string): void {
    this.player?.cueVideoById(videoId)
  }

  setRate(rate: number): void {
    this.player?.setPlaybackRate(rate)
  }

  getRate(): number {
    try {
      return this.player?.getPlaybackRate() ?? 1
    } catch {
      return 1
    }
  }

  getTime(): number {
    try {
      return this.player?.getCurrentTime() ?? 0
    } catch {
      return 0
    }
  }

  getDuration(): number {
    try {
      return this.player?.getDuration() ?? 0
    } catch {
      return 0
    }
  }

  setVolume(v: number): void {
    this.player?.setVolume(Math.min(100, Math.max(0, v)))
  }

  destroy(): void {
    try {
      this.player?.destroy()
    } catch {
      // 破棄済みでも気にしない。
    }
    this.player = null
    this.ready = false
  }
}
