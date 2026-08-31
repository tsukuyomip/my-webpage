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
}: {
  shots: Shot[]
  roster: Character[]
  query: string
  onOpen: (shot: Shot) => void
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
        const name = speaker?.name ?? shot.speakerRaw
        const body = oneLine(shot.body ?? '')

        return (
          <li key={shot.id}>
            <button className="cell" onClick={() => onOpen(shot)}>
              <Thumb id={shot.id} alt={shot.fileName} />
              <div className="caption">
                {(name || shot.story) && (
                  <span className="caption-head">
                    {speaker?.color && (
                      <span className="chip-dot" style={{ background: speaker.color }} />
                    )}
                    {/* 名前が先。入りきらないときに削れるのは、うしろの話数のほう。 */}
                    <span className="caption-name">
                      {name}
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
