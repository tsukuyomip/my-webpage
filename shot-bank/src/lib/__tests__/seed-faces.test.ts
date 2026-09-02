import { describe, expect, it } from 'vitest'
import { EMBED_SIZE, EMBED_VERSION } from '../embed'
import { gakumas } from '../profiles/gakumas'
import { seedFaces, SEED_EMBED_VERSION } from '../profiles/seedFaces'
import { seedRoster } from '../roster'
import { AUTO_CONFIDENCE, autoAssign, seedExamples, suggestFor } from '../suggest'
import type { Face, Shot } from '../types'

const { roster } = seedRoster([], gakumas.knownCharacters)

/**
 * 配ってある見本が、何もない端末でそのまま効くか。
 *
 * **これは「効き方」の試験ではない**（見本そのものを見本で当てても意味がない）。
 * 当たり具合は real-faces.test.ts の 1 つ抜きが答える ── あちらは問う顔を
 * 見本から必ず外すので、「新しい顔が来たとき」と同じ形になっている。
 * ここで見るのは、**配ったものが端末の名簿に結び付いて、実際に道が通るか**。
 */
describe('顔の見本を最初から配る', () => {
  it('版が合っている。合わなければ丸ごと空になる', () => {
    expect(SEED_EMBED_VERSION).toBe(EMBED_VERSION)
    expect(seedFaces.length).toBeGreaterThan(0)
  })

  it('名前は種の名簿に居る人だけ', () => {
    const known = new Set(gakumas.knownCharacters.map((c) => c.name))
    for (const s of seedFaces) expect(known, s.name).toContain(s.name)
  })

  it('名簿から引き当てて、決まった長さの並びになる', () => {
    const ex = seedExamples(roster)
    expect(ex.length).toBe(seedFaces.reduce((a, s) => a + s.embeds.length, 0))
    const ids = new Set(roster.map((c) => c.id))
    for (const e of ex) {
      expect(ids).toContain(e.characterId)
      expect(e.embed).toHaveLength(EMBED_SIZE)
      // 丸めた値を戻して長さ 1 に揃え直している
      expect(Math.sqrt(e.embed.reduce((a, x) => a + x * x, 0))).toBeCloseTo(1, 5)
    }
  })

  it('名簿が空なら何も出さない', () => {
    // 引き当てる先が無い。id をでっち上げると、誰でもない人の提案が出る。
    expect(seedExamples([])).toHaveLength(0)
  })

  it('名簿から消した人ぶんは出さない', () => {
    const without = roster.filter((c) => c.name !== 'ことね')
    const ex = seedExamples(without)
    const kotone = roster.find((c) => c.name === 'ことね')!
    expect(ex.some((e) => e.characterId === kotone.id)).toBe(false)
    expect(ex.length).toBeLessThan(seedExamples(roster).length)
  })

  it('見本 0 枚の端末でも、1 枚目から提案が出る', () => {
    // ここが配る理由そのもの。名簿しか無い状態から始まる。
    const probe = seedExamples(roster)[0]!
    const shot = {
      id: 's',
      faces: [{ id: 'f', x: 0, y: 0, w: 1, h: 1, embed: probe.embed, embedV: EMBED_VERSION }],
    } as Shot
    const got = suggestFor(shot, [shot], roster)
    expect(got.get('f')?.characterId).toBe(probe.characterId)
    // 名簿を渡さなければ、これまでどおり黙る
    expect(suggestFor(shot, [shot]).size).toBe(0)
  })

  it('配った見本からでも仮で付く', () => {
    const probe = seedExamples(roster)[0]!
    const shot = {
      id: 's',
      faces: [{ id: 'f', x: 0, y: 0, w: 1, h: 1, embed: probe.embed, embedV: EMBED_VERSION }],
    } as Shot
    const next = autoAssign([shot], roster).get('s')!
    expect(next[0]!.characterId).toBe(probe.characterId)
    expect(next[0]!.assigned).toBe('guess')
  })

  it('配った見本は、確信が足りなければ付けない', () => {
    // 配ってあるからといって、何にでも名前が付くわけではない。
    const flat: Face = {
      id: 'f', x: 0, y: 0, w: 1, h: 1, embedV: EMBED_VERSION,
      embed: Array.from({ length: EMBED_SIZE }, () => 1 / Math.sqrt(EMBED_SIZE)),
    }
    const shot = { id: 's', faces: [flat] } as Shot
    const got = suggestFor(shot, [shot], roster).get('f')
    expect(got ? got.confidence : 0).toBeLessThan(AUTO_CONFIDENCE)
    expect(autoAssign([shot], roster).has('s')).toBe(false)
  })
})

describe('プロデューサーが喋った枚', () => {
  // 一人称なので画面に出てこない。出ているのは話し相手のほう。
  // 実データでも、美鈴が写っている枚にプロデューサー名が付いていた。
  const me = { id: 'me', name: '2943', aliases: [], isProducer: true, createdAt: 0 }
  const her = { id: 'her', name: '美鈴', aliases: [], createdAt: 0 }
  const one = { id: 'f', x: 0, y: 0, w: 1, h: 1 } as Face

  it('話者がプロデューサーなら、顔にその名前を付けない', () => {
    const shot = { id: 's', speakerId: 'me', faces: [one] } as Shot
    expect(autoAssign([shot], [me, her]).has('s')).toBe(false)
  })

  it('ふつうの話者なら、これまでどおり付ける', () => {
    const shot = { id: 's', speakerId: 'her', faces: [one] } as Shot
    const next = autoAssign([shot], [me, her]).get('s')!
    expect(next[0]!.characterId).toBe('her')
    expect(next[0]!.assigned).toBe('speaker')
  })

  it('名簿を渡さなければ、プロデューサーかどうか分からないので付ける', () => {
    // 名簿なしでも動く道は残す。分からないものを勝手に止めない。
    expect(autoAssign([{ id: 's', speakerId: 'me', faces: [one] } as Shot]).has('s')).toBe(true)
  })
})
