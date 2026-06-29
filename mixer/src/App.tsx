import { useState } from 'react'
import { FileDrop } from './components/FileDrop'
import { ProjectBar } from './components/ProjectBar'
import { SeBank } from './components/SeBank'
import { Timeline } from './components/Timeline'
import { TrackList } from './components/TrackList'
import { Transport } from './components/Transport'
import { VideoGrid, type VideoLayout } from './components/VideoGrid'
import { useAudioEngine, useTransportPosition } from './audio/useAudioEngine'
import { loadProject, saveProject } from './storage/projectStore'

export default function App() {
  const { engine, snapshot } = useAudioEngine()
  const position = useTransportPosition(engine, snapshot.isPlaying)
  const seCues = snapshot.ses.flatMap((s) => s.cues.map((c) => c.time))

  const [layout, setLayout] = useState<VideoLayout>('grid')
  const [greyOpacity, setGreyOpacity] = useState(0.25)
  const hasVideo = snapshot.tracks.some((t) => t.kind === 'video')

  return (
    <div className="app">
      <header className="app-header">
        <h1>🎛️ Mixer</h1>
        <p className="tagline">
          複数の音源・動画をタイムライン上で整列し、mute / solo / SE を切り替えながらプレビュー
        </p>
      </header>

      <main className="app-main">
        <FileDrop onFiles={(files) => files.forEach((f) => engine.addTrack(f))} />

        <ProjectBar
          onSave={(name) => saveProject(name, engine.toProject())}
          onLoad={async (name) => {
            const p = await loadProject(name)
            if (p) await engine.loadProject(p)
          }}
        />

        {hasVideo && (
          <div className="videobar">
            <div className="videobar__layouts" role="group" aria-label="レイアウト">
              {(['grid', 'row', 'column'] as const).map((l) => (
                <button
                  key={l}
                  className={`videobar__btn${layout === l ? ' is-active' : ''}`}
                  onClick={() => setLayout(l)}
                >
                  {l === 'grid' ? 'グリッド' : l === 'row' ? '横並び' : '縦並び'}
                </button>
              ))}
            </div>
            <label className="videobar__opacity">
              グレーアウト透過度
              <input
                type="range"
                min="0"
                max="1"
                step="0.05"
                value={greyOpacity}
                onChange={(e) => setGreyOpacity(parseFloat(e.target.value))}
              />
              <span className="videobar__opacity-val">
                {Math.round(greyOpacity * 100)}%
              </span>
            </label>
          </div>
        )}

        <VideoGrid
          tracks={snapshot.tracks}
          getElement={(id) => engine.getElement(id)}
          layout={layout}
          greyOpacity={greyOpacity}
        />

        <Transport
          isPlaying={snapshot.isPlaying}
          position={position}
          duration={snapshot.duration}
          onTogglePlay={() => engine.togglePlay()}
          onSeek={(p) => engine.seek(p)}
          onStop={() => {
            engine.pause()
            engine.seek(0)
          }}
        />

        <Timeline
          tracks={snapshot.tracks}
          seCues={seCues}
          position={position}
          duration={snapshot.duration}
          onSeek={(p) => engine.seek(p)}
          onSetOffset={(id, offset) => engine.setOffset(id, offset)}
        />

        <TrackList
          tracks={snapshot.tracks}
          onToggleMute={(id, muted) => engine.setMuted(id, muted)}
          onToggleSolo={(id, soloed) => engine.setSoloed(id, soloed)}
          onRemove={(id) => engine.removeTrack(id)}
          onAddMarker={(id, type) => engine.addMarker(id, type)}
          onRemoveMarker={(id, markerId) => engine.removeMarker(id, markerId)}
          onMoveMarker={(id, markerId, time) => engine.moveMarker(id, markerId, time)}
        />

        <SeBank
          ses={snapshot.ses}
          onAddSe={(files) => files.forEach((f) => void engine.addSe(f))}
          onRemoveSe={(id) => engine.removeSe(id)}
          onPlaySe={(id) => engine.playSe(id)}
          onAddCue={(id) => engine.addCue(id)}
          onRemoveCue={(id, cueId) => engine.removeCue(id, cueId)}
          onMoveCue={(id, cueId, time) => engine.moveCue(id, cueId, time)}
        />
      </main>
    </div>
  )
}
