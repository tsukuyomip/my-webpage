import { FileDrop } from './components/FileDrop'
import { SeBank } from './components/SeBank'
import { Timeline } from './components/Timeline'
import { TrackList } from './components/TrackList'
import { Transport } from './components/Transport'
import { useAudioEngine, useTransportPosition } from './audio/useAudioEngine'

export default function App() {
  const { engine, snapshot } = useAudioEngine()
  const position = useTransportPosition(engine, snapshot.isPlaying)
  const seCues = snapshot.ses.flatMap((s) => s.cues.map((c) => c.time))

  return (
    <div className="app">
      <header className="app-header">
        <h1>🎛️ Mixer</h1>
        <p className="tagline">
          複数の音源をタイムライン上で整列し、mute / solo を切り替えながらプレビュー
        </p>
      </header>

      <main className="app-main">
        <FileDrop onFiles={(files) => files.forEach((f) => void engine.addTrack(f))} />

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
