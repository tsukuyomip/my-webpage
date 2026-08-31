import { buildSnippet } from '../lib/search'
import { matchShot } from '../lib/matching'
import type { Shot } from '../lib/types'
import { formatStory } from '../lib/story'
import { Highlight } from './Highlight'
import { Thumb } from './Thumb'

export function ShotGrid({
  shots,
  query,
  onOpen,
}: {
  shots: Shot[]
  query: string
  onOpen: (shot: Shot) => void
}) {
  const searching = query.trim().length > 0
  return (
    <ul className={searching ? 'grid searching' : 'grid'}>
      {shots.map((shot) => {
        // 探しているときは「どこが当たったか」を出す。
        // サムネだけでは、どの 1 枚かを絞り込めない。
        const match = searching ? matchShot(shot, query) : null
        const hit = match?.bodyMatch ?? match?.speakerMatch ?? match?.storyMatch ?? match?.nameMatch
        return (
          <li key={shot.id}>
            <button className="cell" onClick={() => onOpen(shot)}>
              <Thumb id={shot.id} alt={shot.fileName} />
            </button>
            {searching && (
              <div className="caption">
                {(shot.speakerRaw || shot.story) && (
                  <span className="caption-head">
                    {shot.speakerRaw}
                    {shot.speakerRaw && shot.story ? ' · ' : ''}
                    {shot.story ? formatStory(shot.story) : ''}
                  </span>
                )}
                {hit && <Highlight snippet={buildSnippet(hit)} />}
              </div>
            )}
          </li>
        )
      })}
    </ul>
  )
}
