import { fontById } from './fonts'
import type { MeasureFactory } from './render'
import type { Measure } from './text'

/**
 * ブラウザでの幅の測り方。
 *
 * 1 文字ずつ何度も measureText を呼ぶので、書体と文字で覚えておく。
 * 100px で測って割る。組みは em で持っているので、大きさごとに測り直す必要はない。
 */
export function browserMeasure(): MeasureFactory {
  const canvas = document.createElement('canvas')
  const ctx = canvas.getContext('2d')
  const cache = new Map<string, number>()

  return (fontId: string): Measure => {
    const stack = fontById(fontId).stack
    return (text: string) => {
      const key = `${fontId} ${text}`
      const hit = cache.get(key)
      if (hit !== undefined) return hit
      if (!ctx) return text.length
      ctx.font = `400 100px ${stack}`
      const w = ctx.measureText(text).width / 100
      cache.set(key, w)
      return w
    }
  }
}
