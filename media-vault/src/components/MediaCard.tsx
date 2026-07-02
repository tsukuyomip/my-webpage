import { formatTime } from '../lib/format'
import type { ItemMatch } from '../lib/matching'
import { headSnippet } from '../lib/search'
import type { MediaMeta } from '../lib/types'
import { BlobImage } from './BlobImage'
import { Highlight } from './Highlight'

const KIND_ICON = { image: '🖼️', video: '🎬', audio: '🎵' } as const

export const STATUS_LABEL = {
  queued: '認識待ち',
  processing: '認識中…',
  done: '認識済み',
  error: 'エラー',
} as const

export function MediaCard({
  meta,
  match,
  hasQuery,
  onOpen,
}: {
  meta: MediaMeta
  match: ItemMatch
  hasQuery: boolean
  onOpen: () => void
}) {
  const firstSegment = match.segmentMatches[0]

  // With an active query, prefer showing where it hit; otherwise preview the text.
  let snippet: React.ReactNode = null
  if (hasQuery) {
    if (firstSegment && (meta.kind === 'video' || meta.kind === 'audio')) {
      snippet = (
        <>
          <span className="seg-time">{formatTime(firstSegment.segment.start)}</span>{' '}
          <Highlight match={firstSegment.match} />
        </>
      )
    } else if (match.textMatch) {
      snippet = <Highlight match={match.textMatch} />
    } else if (match.nameMatch) {
      snippet = (
        <span className="muted">
          ファイル名に一致: <Highlight match={match.nameMatch} />
        </span>
      )
    }
  } else if (meta.text) {
    snippet = headSnippet(meta.text)
  }

  return (
    <button type="button" className="media-card" onClick={onOpen} data-id={meta.id}>
      <div className="thumb">
        {meta.thumb ? (
          <BlobImage blob={meta.thumb} alt={meta.name} />
        ) : (
          <span className="thumb-icon">{KIND_ICON[meta.kind]}</span>
        )}
        {meta.duration !== undefined && (
          <span className="duration">{formatTime(meta.duration)}</span>
        )}
        <span className={`status status-${meta.status}`}>{STATUS_LABEL[meta.status]}</span>
      </div>
      <div className="card-body">
        <div className="card-name" title={meta.name}>
          {KIND_ICON[meta.kind]} {meta.name}
        </div>
        {snippet && <p className="snippet">{snippet}</p>}
        {meta.status === 'error' && meta.error && (
          <p className="snippet error-text">{meta.error}</p>
        )}
      </div>
    </button>
  )
}
