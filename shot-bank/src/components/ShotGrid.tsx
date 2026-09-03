import { matchShot } from '../lib/matching'
import { squeezeJapaneseSpaces } from '../lib/plausible'
import { buildSnippet } from '../lib/search'
import { formatStory } from '../lib/story'
import type { Character, Shot } from '../lib/types'
import { Highlight } from './Highlight'
import { Thumb } from './Thumb'

/**
 * 本文を 1 行に均す。
 * 改行はセリフの折り返しなので、つないだあとに日本語どうしの空白を詰め直す。
 * そうしないと「〜って、 そう言って」のように、折り返しの跡が空白として残る。
 */
function oneLine(body: string): string {
  return squeezeJapaneseSpaces(body.replace(/\s*\n\s*/g, ' ')).trim()
}

export function ShotGrid({
  shots,
  roster,
  query,
  onOpen,
  selecting = false,
  selectedIds,
  onToggleSelect,
}: {
  shots: Shot[]
  roster: Character[]
  query: string
  onOpen: (shot: Shot) => void
  /** 選ぶモード。押すと開くのではなく、選ぶ／外す */
  selecting?: boolean
  selectedIds?: Set<string>
  onToggleSelect?: (shot: Shot) => void
}) {
  const searching = query.trim().length > 0
  const byId = new Map(roster.map((c) => [c.id, c]))

  return (
    <ul className={searching ? 'grid searching' : 'grid'}>
      {shots.map((shot) => {
        // 探しているときは「どこが当たったか」を出す。
        // ふだんは「誰が何を言ったか」を出す。どちらもサムネだけでは分からない。
        const match = searching ? matchShot(shot, query) : null
        const hit = match?.bodyMatch ?? match?.speakerMatch ?? match?.storyMatch ?? match?.nameMatch
        const speaker = shot.speakerId ? byId.get(shot.speakerId) : undefined
        // speakerRaw は「読み取ったが空だった」で '' が入ることがある。?? は ''
        // を「値あり」とみなして拾ってしまうので、|| で空文字も無しとして扱う。
        const speakerName = speaker?.name || shot.speakerRaw || undefined
        // 話者が読めなかった枚でも、顔が判定できていれば名前を出す。仮でもよい
        // ── 一覧をぱっと見て誰が写っているか分かるほうが、確定にこだわるより要る。
        // 絞り込み・検索は characterIds のままで、ここは表示だけ足す。
        const facedFace = !speakerName ? (shot.faces ?? []).find((f) => f.characterId) : undefined
        const faceChar = facedFace?.characterId ? byId.get(facedFace.characterId) : undefined
        const name = speakerName ?? faceChar?.name
        const tentative = !speakerName && !!facedFace?.assigned
        const color = speaker?.color ?? faceChar?.color
        const body = oneLine(shot.body ?? '')

        const picked = selecting && selectedIds?.has(shot.id) === true

        return (
          <li key={shot.id}>
            <button
              className={picked ? 'cell picked' : 'cell'}
              // 選ぶモードでは、押しても開かない。開きたいときはモードを抜けてもらう。
              // 同じ押下に 2 つの意味を持たせると、送るつもりが開いてしまう。
              onClick={() => (selecting ? onToggleSelect?.(shot) : onOpen(shot))}
              aria-pressed={selecting ? picked : undefined}
            >
              {selecting && <span className="pick" aria-hidden="true" />}
              <Thumb id={shot.id} alt={shot.fileName} />
              <div className="caption">
                {(name || shot.story) && (
                  <span className="caption-head">
                    {color && <span className="chip-dot" style={{ background: color }} />}
                    {/* 名前が先。入りきらないときに削れるのは、うしろの話数のほう。 */}
                    <span className="caption-name">
                      {name}
                      {tentative ? '（仮）' : ''}
                      {name && shot.story ? ' · ' : ''}
                      {shot.story ? formatStory(shot.story) : ''}
                    </span>
                  </span>
                )}
                {hit ? (
                  <Highlight snippet={buildSnippet(hit)} />
                ) : (
                  body && <span className="caption-body">{body}</span>
                )}
              </div>
            </button>
          </li>
        )
      })}
    </ul>
  )
}
