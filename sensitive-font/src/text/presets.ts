/** スタイルと文字列のプリセット。 */

import type { Config } from '../state/types'

export type StylePreset = {
  name: string
  patch: Partial<Config>
}

export const STYLE_PRESETS: StylePreset[] = [
  {
    name: '白フチ極太',
    patch: {
      fontId: 'dela-gothic-one',
      fill: {
        mode: 'solid',
        color1: '#ffffff',
        color2: '#ff5f9e',
        useColor3: false,
        color3: '#ffe36e',
        angle: 0,
        stripeCount: 6,
      },
      strokes: [
        { color: '#ff3d7f', width: 8 },
        { color: '#ffffff', width: 6 },
      ],
      shadow: { enabled: false, color: '#00000080', blur: 12, offsetX: 0, offsetY: 6 },
      hardShadow: { enabled: false, color: '#2a0d1a', offsetX: 8, offsetY: 8 },
      jitter: { enabled: false, mode: 'random', size: 10, angle: 6, offset: 6, seed: 1 },
      skew: 0,
      rotate: 0,
      arch: 0,
    },
  },
  {
    name: '桃グラデ',
    patch: {
      fontId: 'm-plus-rounded-1c',
      fill: {
        mode: 'gradient',
        color1: '#fff4fa',
        color2: '#ff6fae',
        useColor3: false,
        color3: '#ffe36e',
        angle: 0,
        stripeCount: 6,
      },
      strokes: [
        { color: '#6b1436', width: 5 },
        { color: '#ffffff', width: 9 },
      ],
      shadow: { enabled: true, color: '#5c0f2c66', blur: 10, offsetX: 0, offsetY: 6 },
      hardShadow: { enabled: false, color: '#2a0d1a', offsetX: 8, offsetY: 8 },
      jitter: { enabled: false, mode: 'random', size: 10, angle: 6, offset: 6, seed: 1 },
      skew: 0,
      rotate: 0,
      arch: 0,
    },
  },
  {
    name: '極太明朝',
    patch: {
      fontId: 'shippori-mincho-b1',
      fill: {
        mode: 'solid',
        color1: '#111111',
        color2: '#ff5f9e',
        useColor3: false,
        color3: '#ffe36e',
        angle: 0,
        stripeCount: 6,
      },
      strokes: [{ color: '#ffffff', width: 10 }],
      shadow: { enabled: false, color: '#00000080', blur: 12, offsetX: 0, offsetY: 6 },
      hardShadow: { enabled: false, color: '#2a0d1a', offsetX: 8, offsetY: 8 },
      jitter: { enabled: false, mode: 'random', size: 10, angle: 6, offset: 6, seed: 1 },
      skew: 0,
      rotate: 0,
      arch: 0,
    },
  },
  {
    name: '縦書き明朝',
    patch: {
      fontId: 'shippori-mincho-b1',
      vertical: true,
      fill: {
        mode: 'solid',
        color1: '#ffffff',
        color2: '#ff5f9e',
        useColor3: false,
        color3: '#ffe36e',
        angle: 0,
        stripeCount: 6,
      },
      strokes: [{ color: '#000000', width: 7 }],
      shadow: { enabled: false, color: '#00000080', blur: 12, offsetX: 0, offsetY: 6 },
      hardShadow: { enabled: false, color: '#2a0d1a', offsetX: 8, offsetY: 8 },
      jitter: { enabled: false, mode: 'random', size: 10, angle: 6, offset: 6, seed: 1 },
      skew: 0,
      rotate: 0,
      arch: 0,
    },
  },
  {
    name: 'ぷるぷる手書き',
    patch: {
      fontId: 'hachi-maru-pop',
      fill: {
        mode: 'solid',
        color1: '#ffffff',
        color2: '#ff5f9e',
        useColor3: false,
        color3: '#ffe36e',
        angle: 0,
        stripeCount: 6,
      },
      strokes: [
        { color: '#ff86b8', width: 6 },
        { color: '#ffffff', width: 5 },
      ],
      shadow: { enabled: false, color: '#00000080', blur: 12, offsetX: 0, offsetY: 6 },
      hardShadow: { enabled: false, color: '#2a0d1a', offsetX: 8, offsetY: 8 },
      jitter: { enabled: true, mode: 'random', size: 12, angle: 9, offset: 8, seed: 7 },
      skew: 0,
      rotate: 0,
      arch: 0,
    },
  },
  {
    name: 'ベタ影ポップ',
    patch: {
      fontId: 'potta-one',
      fill: {
        mode: 'gradient',
        color1: '#fff8d6',
        color2: '#ffbe3d',
        useColor3: false,
        color3: '#ffe36e',
        angle: 0,
        stripeCount: 6,
      },
      strokes: [{ color: '#3a2000', width: 7 }],
      shadow: { enabled: false, color: '#00000080', blur: 12, offsetX: 0, offsetY: 6 },
      hardShadow: { enabled: true, color: '#3a2000', offsetX: 10, offsetY: 10 },
      jitter: { enabled: false, mode: 'random', size: 10, angle: 6, offset: 6, seed: 1 },
      skew: -8,
      rotate: 0,
      arch: 0,
    },
  },
  {
    name: '効果音（斜め）',
    patch: {
      fontId: 'reggae-one',
      fill: {
        mode: 'solid',
        color1: '#000000',
        color2: '#ff5f9e',
        useColor3: false,
        color3: '#ffe36e',
        angle: 0,
        stripeCount: 6,
      },
      strokes: [
        { color: '#000000', width: 4 },
        { color: '#ffffff', width: 8 },
      ],
      shadow: { enabled: false, color: '#00000080', blur: 12, offsetX: 0, offsetY: 6 },
      hardShadow: { enabled: false, color: '#2a0d1a', offsetX: 8, offsetY: 8 },
      jitter: { enabled: false, mode: 'random', size: 10, angle: 6, offset: 6, seed: 1 },
      skew: -12,
      rotate: -6,
      arch: 0,
    },
  },
  {
    name: '擬音（エチオン）',
    patch: {
      fontId: 'echion',
      fill: {
        mode: 'solid',
        color1: '#ffffff',
        color2: '#ff5f9e',
        useColor3: false,
        color3: '#ffe36e',
        angle: 0,
        stripeCount: 6,
      },
      strokes: [
        { color: '#1a0710', width: 5 },
        { color: '#ffffff', width: 7 },
      ],
      shadow: { enabled: false, color: '#00000080', blur: 12, offsetX: 0, offsetY: 6 },
      hardShadow: { enabled: false, color: '#2a0d1a', offsetX: 8, offsetY: 8 },
      jitter: { enabled: true, mode: 'wave', size: 8, angle: 5, offset: 7, seed: 3 },
      skew: 0,
      rotate: 0,
      arch: 0,
    },
  },
  {
    name: 'ドット',
    patch: {
      fontId: 'dotgothic16',
      fill: {
        mode: 'solid',
        color1: '#7dff9b',
        color2: '#ff5f9e',
        useColor3: false,
        color3: '#ffe36e',
        angle: 0,
        stripeCount: 6,
      },
      strokes: [{ color: '#062b12', width: 6 }],
      shadow: { enabled: false, color: '#00000080', blur: 12, offsetX: 0, offsetY: 6 },
      hardShadow: { enabled: false, color: '#2a0d1a', offsetX: 8, offsetY: 8 },
      jitter: { enabled: false, mode: 'random', size: 10, angle: 6, offset: 6, seed: 1 },
      skew: 0,
      rotate: 0,
      arch: 0,
    },
  },
]

/** よく使う文字列。クリックで入力欄に流し込む。 */
export const TEXT_PRESETS: { group: string; items: string[] }[] = [
  {
    group: 'あえぎ',
    items: ['んっ♡', 'あっ…♡', 'はぁっ♡', 'イッちゃう♡', 'イ゙グッ♡', 'らめぇ♡', 'んほぉ♡', 'ぐすっ…'],
  },
  {
    group: '効果音',
    items: ['ドクンッ', 'ビクビクッ', 'ぬるっ', 'ぐちゅ', 'パンパンッ', 'ズンッ', 'ドドド', 'ぴちゃ'],
  },
  {
    group: '記号',
    items: ['♡', '♡♡♡', '❤', '★', '…', '——', '！？', '〜〜'],
  },
]
