import { useEffect, useMemo, useState } from 'react'
import { decodeFile, toMono } from './audio/decode.ts'
import { analyzeBuffer } from './audio/analyze.ts'
import { buildMedley, type MedleyResult } from './audio/medley.ts'
import { channelsToAudioBuffer } from './audio/toAudioBuffer.ts'
import { encodeWav } from './audio/wav.ts'
import { player, beatGrid } from './audio/player.ts'
import { Waveform } from './components/Waveform.tsx'
import type { Analysis, BpmMode, MergeSettings, Track } from './audio/types.ts'

interface UITrack extends Track {
  mono: Float32Array
  duration: number
  viewStart: number
  viewDur: number
  cursor: number
}

const MIN_VIEW_DUR = 0.5

function median(values: number[]): number {
  if (values.length === 0) return 120
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v))

function zoomView(
  view: { viewStart: number; viewDur: number },
  factor: number,
  center: number,
  duration: number,
): { viewStart: number; viewDur: number } {
  const viewDur = clamp(view.viewDur * factor, Math.min(MIN_VIEW_DUR, duration), duration)
  let viewStart = center - (center - view.viewStart) * (viewDur / view.viewDur)
  viewStart = clamp(viewStart, 0, Math.max(0, duration - viewDur))
  return { viewStart, viewDur }
}

// One id identifies whatever is currently sounding: a track id or 'output'.
type PlayId = string | 'output' | null
type PlayMode = 'full' | 'segment'

export default function App() {
  const [tracks, setTracks] = useState<UITrack[]>([])
  const [loading, setLoading] = useState<string | null>(null)
  const [building, setBuilding] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [mode, setMode] = useState<BpmMode>('unify')
  const [targetBpm, setTargetBpm] = useState(120)
  const [targetTouched, setTargetTouched] = useState(false)
  const [crossfadeBeats, setCrossfadeBeats] = useState(8)
  const [keyBridge, setKeyBridge] = useState(false)

  const [loopOn, setLoopOn] = useState(false)
  const [metroOn, setMetroOn] = useState(false)

  const [medley, setMedley] = useState<MedleyResult | null>(null)
  const [medleyBuffer, setMedleyBuffer] = useState<AudioBuffer | null>(null)
  const [outMono, setOutMono] = useState<Float32Array | null>(null)
  const [outView, setOutView] = useState({ viewStart: 0, viewDur: 1 })
  const [outCursor, setOutCursor] = useState(0)

  const [playId, setPlayId] = useState<PlayId>(null)
  const [playMode, setPlayMode] = useState<PlayMode>('full')
  const [position, setPosition] = useState(0)

  useEffect(() => {
    if (!targetTouched && tracks.length > 0) {
      setTargetBpm(Math.round(median(tracks.map((t) => t.analysis.tempo.bpm))))
    }
  }, [tracks, targetTouched])

  // Drive the playhead from the shared player while anything is sounding.
  useEffect(() => {
    if (playId === null) return
    let raf = 0
    const tick = () => {
      setPosition(player.position())
      if (!player.isPlaying()) setPlayId(null)
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [playId])

  const onFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return
    setError(null)
    for (const file of Array.from(files)) {
      setLoading(file.name)
      await new Promise((r) => setTimeout(r, 10))
      try {
        const buffer = await decodeFile(file)
        const analysis = analyzeBuffer(buffer)
        const track: UITrack = {
          id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          name: file.name.replace(/\.[^.]+$/, ''),
          buffer,
          analysis,
          segmentStart: 0,
          segmentEnd: buffer.duration,
          mono: toMono(buffer),
          duration: buffer.duration,
          viewStart: 0,
          viewDur: buffer.duration,
          cursor: 0,
        }
        setTracks((prev) => [...prev, track])
      } catch (e) {
        setError(`「${file.name}」を読み込めませんでした: ${(e as Error).message}`)
      }
    }
    setLoading(null)
  }

  const updateTrack = (id: string, patch: Partial<UITrack>) =>
    setTracks((prev) => prev.map((t) => (t.id === id ? { ...t, ...patch } : t)))

  const setTrackTempo = (id: string, bpm: number, beatOffset?: number) =>
    setTracks((prev) =>
      prev.map((t) => {
        if (t.id !== id) return t
        const tempo = {
          ...t.analysis.tempo,
          bpm: clamp(bpm, 40, 260),
          beatOffset: beatOffset ?? t.analysis.tempo.beatOffset,
        }
        const analysis: Analysis = { ...t.analysis, tempo }
        return { ...t, analysis }
      }),
    )

  const stop = () => {
    player.stop()
    setPlayId(null)
  }

  const removeTrack = (id: string) => {
    if (playId === id) stop()
    setTracks((prev) => prev.filter((t) => t.id !== id))
  }

  const moveTrack = (id: string, dir: -1 | 1) =>
    setTracks((prev) => {
      const idx = prev.findIndex((t) => t.id === id)
      const next = idx + dir
      if (idx < 0 || next < 0 || next >= prev.length) return prev
      const copy = [...prev]
      ;[copy[idx], copy[next]] = [copy[next], copy[idx]]
      return copy
    })

  const settings: MergeSettings = useMemo(
    () => ({ mode, targetBpm, crossfadeBeats, keyBridge }),
    [mode, targetBpm, crossfadeBeats, keyBridge],
  )

  const playTrack = (track: UITrack, m: PlayMode, from?: number) => {
    const grid = beatGrid(track.analysis.tempo.bpm, track.analysis.tempo.beatOffset, track.duration)
    const startSec = m === 'segment' ? track.segmentStart : from ?? track.cursor
    player.play({
      buffer: track.buffer,
      loop: loopOn,
      beatTimes: grid,
      metronomeGain: metroOn ? 0.5 : 0,
      startSec,
      ...(m === 'segment' ? { endSec: track.segmentEnd } : {}),
      onEnded: () => setPlayId(null),
    })
    setPlayId(track.id)
    setPlayMode(m)
    setPosition(startSec)
  }

  const toggleTrack = (track: UITrack, m: PlayMode) => {
    if (playId === track.id && playMode === m) stop()
    else playTrack(track, m)
  }

  const seekTrack = (track: UITrack, t: number) => {
    updateTrack(track.id, { cursor: t })
    if (playId === track.id && playMode === 'full') playTrack({ ...track, cursor: t }, 'full', t)
  }

  const build = async () => {
    if (tracks.length === 0) return
    stop()
    setBuilding(true)
    setError(null)
    setMedley(null)
    setMedleyBuffer(null)
    setOutMono(null)
    await new Promise((r) => setTimeout(r, 20))
    try {
      const result = buildMedley(tracks, settings)
      const buffer = channelsToAudioBuffer(result.channels, result.sampleRate)
      const mono = new Float32Array(result.channels[0].length)
      for (let i = 0; i < mono.length; i++) {
        mono[i] = (result.channels[0][i] + result.channels[1][i]) / 2
      }
      setMedley(result)
      setMedleyBuffer(buffer)
      setOutMono(mono)
      setOutView({ viewStart: 0, viewDur: result.durationSec || 1 })
      setOutCursor(0)
    } catch (e) {
      setError(`メドレー生成に失敗しました: ${(e as Error).message}`)
    } finally {
      setBuilding(false)
    }
  }

  const outputGrid = useMemo(() => {
    if (!medley) return []
    return mode === 'unify' ? beatGrid(targetBpm, 0, medley.durationSec) : []
  }, [medley, mode, targetBpm])

  const playOutput = (from?: number) => {
    if (!medleyBuffer || !medley) return
    const startSec = from ?? outCursor
    player.play({
      buffer: medleyBuffer,
      loop: loopOn,
      beatTimes: outputGrid,
      metronomeGain: metroOn ? 0.5 : 0,
      startSec,
      onEnded: () => setPlayId(null),
    })
    setPlayId('output')
    setPlayMode('full')
    setPosition(startSec)
  }

  const toggleOutput = () => {
    if (playId === 'output') stop()
    else playOutput()
  }

  const seekOutput = (t: number) => {
    setOutCursor(t)
    if (playId === 'output') playOutput(t)
  }

  const download = () => {
    if (!medley) return
    const blob = encodeWav(medley.channels, medley.sampleRate)
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'medley.wav'
    a.click()
    setTimeout(() => URL.revokeObjectURL(url), 4000)
  }

  return (
    <div className="app">
      <header className="topbar">
        <h1>🎚️ Make Medley</h1>
        <p className="tagline">
          曲を読み込むと BPM と調を自動で解析し、拍を揃えてクロスフェードで
          メドレーにします。すべて端末内で処理され、音源はどこにも送信されません。
        </p>
      </header>

      <section className="importer">
        <label className="dropzone">
          <input
            type="file"
            accept="audio/*,.mp3,.m4a,.wav,.aac,.ogg,.oga,.opus,.flac,.weba,.webm"
            multiple
            onChange={(e) => {
              void onFiles(e.target.files)
              e.target.value = ''
            }}
          />
          <span className="dropzone-label">
            🎵 音楽ファイルを選択（複数可・mp3 / wav / m4a など）
          </span>
        </label>
        {loading && <p className="status">解析中… {loading}</p>}
        {error && <p className="error">{error}</p>}
      </section>

      {tracks.length > 0 && (
        <section className="global-toggles">
          <label className="toggle">
            <input type="checkbox" checked={loopOn} onChange={(e) => setLoopOn(e.target.checked)} />
            🔁 ループ再生
          </label>
          <label className="toggle">
            <input
              type="checkbox"
              checked={metroOn}
              onChange={(e) => setMetroOn(e.target.checked)}
            />
            🥁 メトロノーム（推定拍のプレビュー）
          </label>
        </section>
      )}

      {tracks.length > 0 && (
        <section className="tracks">
          <h2>トラック（上から順に繋がります）</h2>
          {tracks.map((t, i) => (
            <TrackCard
              key={t.id}
              track={t}
              index={i}
              total={tracks.length}
              playing={playId === t.id}
              playMode={playMode}
              position={position}
              onMove={moveTrack}
              onRemove={removeTrack}
              onToggle={toggleTrack}
              onSeek={seekTrack}
              onView={(v) => updateTrack(t.id, v)}
              onSegment={(s, e) => updateTrack(t.id, { segmentStart: s, segmentEnd: e })}
              onTempo={setTrackTempo}
            />
          ))}
        </section>
      )}

      {tracks.length > 0 && (
        <section className="controls">
          <h2>メドレー設定</h2>
          <div className="control-grid">
            <fieldset>
              <legend>BPM の合わせ方</legend>
              <label>
                <input
                  type="radio"
                  name="mode"
                  checked={mode === 'unify'}
                  onChange={() => setMode('unify')}
                />
                すべて同じ BPM に揃える
              </label>
              <label>
                <input
                  type="radio"
                  name="mode"
                  checked={mode === 'gradual'}
                  onChange={() => setMode('gradual')}
                />
                繋ぎ目で徐々に BPM を変える
              </label>
            </fieldset>

            <label className={mode === 'unify' ? '' : 'disabled'}>
              目標 BPM
              <input
                type="number"
                min={40}
                max={240}
                value={targetBpm}
                disabled={mode !== 'unify'}
                onChange={(e) => {
                  setTargetTouched(true)
                  setTargetBpm(Number(e.target.value))
                }}
              />
            </label>

            <label>
              クロスフェード長（拍）
              <input
                type="number"
                min={0}
                max={64}
                value={crossfadeBeats}
                onChange={(e) => setCrossfadeBeats(Math.max(0, Number(e.target.value)))}
              />
            </label>

            <label className="checkbox">
              <input
                type="checkbox"
                checked={keyBridge}
                onChange={(e) => setKeyBridge(e.target.checked)}
              />
              調が違う繋ぎ目に短い接続メロディを挿入（実験的）
            </label>
          </div>

          <button className="build-btn" onClick={() => void build()} disabled={building}>
            {building ? 'メドレー生成中…' : '🎛️ メドレーを生成'}
          </button>
        </section>
      )}

      {medley && medleyBuffer && outMono && (
        <section className="result">
          <h2>プレビュー（出力メドレー）</h2>
          <div className="player">
            <button onClick={toggleOutput}>{playId === 'output' ? '⏹ 停止' : '▶️ 再生'}</button>
            <BeatPulse
              active={playId === 'output' && mode === 'unify'}
              bpm={targetBpm}
              offset={0}
              position={position}
            />
            <button onClick={download}>⬇️ WAV を書き出し</button>
            <span className="duration">
              {formatTime(playId === 'output' ? position : outCursor)} /{' '}
              {formatTime(medley.durationSec)}
            </span>
          </div>
          <ZoomBar
            view={outView}
            duration={medley.durationSec}
            center={playId === 'output' ? position : outCursor}
            onView={setOutView}
          />
          <Waveform
            mono={outMono}
            sampleRate={medley.sampleRate}
            duration={medley.durationSec}
            viewStart={outView.viewStart}
            viewDur={outView.viewDur}
            bpm={mode === 'unify' ? targetBpm : 0}
            beatOffset={0}
            playhead={playId === 'output' ? position : outCursor}
            onSeek={seekOutput}
          />
          <SectionTimeline
            sections={medley.sections}
            duration={medley.durationSec}
            playhead={playId === 'output' ? position : outCursor}
          />
        </section>
      )}

      <footer className="footer">build: {__BUILD_INFO__}</footer>
    </div>
  )
}

function TrackCard({
  track,
  index,
  total,
  playing,
  playMode,
  position,
  onMove,
  onRemove,
  onToggle,
  onSeek,
  onView,
  onSegment,
  onTempo,
}: {
  track: UITrack
  index: number
  total: number
  playing: boolean
  playMode: PlayMode
  position: number
  onMove: (id: string, dir: -1 | 1) => void
  onRemove: (id: string) => void
  onToggle: (track: UITrack, m: PlayMode) => void
  onSeek: (track: UITrack, t: number) => void
  onView: (v: { viewStart: number; viewDur: number }) => void
  onSegment: (start: number, end: number) => void
  onTempo: (id: string, bpm: number, beatOffset?: number) => void
}) {
  const { tempo, key } = track.analysis
  const playhead = playing ? position : track.cursor

  return (
    <div className="track-card">
      <div className="track-head">
        <span className="track-index">{index + 1}</span>
        <span className="track-name">{track.name}</span>
        <span className="badge">🎹 {key.label}</span>
        <span className="track-actions">
          <button onClick={() => onMove(track.id, -1)} disabled={index === 0} title="上へ">
            ↑
          </button>
          <button onClick={() => onMove(track.id, 1)} disabled={index === total - 1} title="下へ">
            ↓
          </button>
          <button onClick={() => onRemove(track.id)} title="削除">
            ✕
          </button>
        </span>
      </div>

      <ZoomBar
        view={{ viewStart: track.viewStart, viewDur: track.viewDur }}
        duration={track.duration}
        center={playhead}
        onView={onView}
      />
      <Waveform
        mono={track.mono}
        sampleRate={track.buffer.sampleRate}
        duration={track.duration}
        viewStart={track.viewStart}
        viewDur={track.viewDur}
        bpm={tempo.bpm}
        beatOffset={tempo.beatOffset}
        segment={{ start: track.segmentStart, end: track.segmentEnd, onChange: onSegment }}
        playhead={playhead}
        onSeek={(t) => onSeek(track, t)}
      />

      <div className="transport">
        <button
          className={playing && playMode === 'full' ? 'active' : ''}
          onClick={() => onToggle(track, 'full')}
        >
          {playing && playMode === 'full' ? '⏹' : '▶️'} 全体
        </button>
        <button
          className={playing && playMode === 'segment' ? 'active' : ''}
          onClick={() => onToggle(track, 'segment')}
        >
          {playing && playMode === 'segment' ? '⏹' : '▶️'} 使用区間
        </button>
        <BeatPulse active={playing} bpm={tempo.bpm} offset={tempo.beatOffset} position={position} />
        <span className="bpm-editor">
          <label>BPM</label>
          <button onClick={() => onTempo(track.id, tempo.bpm / 2)} title="半分">
            ½
          </button>
          <input
            type="number"
            min={40}
            max={260}
            step={0.1}
            value={Math.round(tempo.bpm * 10) / 10}
            onChange={(e) => onTempo(track.id, Number(e.target.value))}
          />
          <button onClick={() => onTempo(track.id, tempo.bpm * 2)} title="2倍">
            ×2
          </button>
          <button
            onClick={() => onTempo(track.id, tempo.bpm, tempo.beatOffset - 0.01)}
            title="拍の位置を左へ"
          >
            ◀
          </button>
          <button
            onClick={() => onTempo(track.id, tempo.bpm, tempo.beatOffset + 0.01)}
            title="拍の位置を右へ"
          >
            ▶
          </button>
        </span>
      </div>

      <div className="track-foot">
        使用区間: {formatTime(track.segmentStart)} – {formatTime(track.segmentEnd)}
        （黄・赤ハンドルをドラッグ／波形クリックで頭出し）
      </div>
    </div>
  )
}

function ZoomBar({
  view,
  duration,
  center,
  onView,
}: {
  view: { viewStart: number; viewDur: number }
  duration: number
  center: number
  onView: (v: { viewStart: number; viewDur: number }) => void
}) {
  const zoomed = view.viewDur < duration - 1e-3
  const maxStart = Math.max(0, duration - view.viewDur)
  const c = clamp(center || view.viewStart + view.viewDur / 2, 0, duration)
  return (
    <div className="zoombar">
      <button onClick={() => onView(zoomView(view, 0.5, c, duration))} title="拡大">
        🔍＋
      </button>
      <button onClick={() => onView(zoomView(view, 2, c, duration))} title="縮小">
        🔍－
      </button>
      <button onClick={() => onView({ viewStart: 0, viewDur: duration })} title="全体表示">
        全体
      </button>
      <input
        className="pan"
        type="range"
        min={0}
        max={maxStart}
        step={Math.max(0.001, duration / 2000)}
        value={Math.min(view.viewStart, maxStart)}
        disabled={!zoomed}
        onChange={(e) => onView({ ...view, viewStart: Number(e.target.value) })}
      />
      <span className="zoom-label">×{(duration / view.viewDur).toFixed(1)}</span>
    </div>
  )
}

/** A heart that pulses on every beat while playing — a visual BPM preview. */
function BeatPulse({
  active,
  bpm,
  offset,
  position,
}: {
  active: boolean
  bpm: number
  offset: number
  position: number
}) {
  let scale = 1
  if (active && bpm > 0) {
    const period = 60 / bpm
    const since = ((position - offset) % period + period) % period
    scale = 1 + 0.6 * Math.exp(-since / (period * 0.3))
  }
  return (
    <span
      className={`beat-pulse ${active ? 'on' : ''}`}
      style={{ transform: `scale(${scale.toFixed(3)})` }}
      title={active ? `${Math.round(bpm)} BPM` : '再生すると拍が脈打ちます'}
    >
      ❤️
    </span>
  )
}

function SectionTimeline({
  sections,
  duration,
  playhead,
}: {
  sections: MedleyResult['sections']
  duration: number
  playhead: number
}) {
  return (
    <div className="timeline">
      {sections.map((s, i) => {
        const start = s.startSec
        const end = i + 1 < sections.length ? sections[i + 1].startSec : duration
        const left = (start / duration) * 100
        const w = ((end - start) / duration) * 100
        return (
          <div
            key={i}
            className={`segment ${s.kind}`}
            style={{ left: `${left}%`, width: `${w}%` }}
            title={`${s.name} @ ${formatTime(start)}`}
          >
            <span>{s.name}</span>
          </div>
        )
      })}
      {duration > 0 && (
        <div className="playhead" style={{ left: `${(playhead / duration) * 100}%` }} />
      )}
    </div>
  )
}

function formatTime(sec: number): string {
  if (!isFinite(sec) || sec < 0) sec = 0
  const m = Math.floor(sec / 60)
  const s = Math.floor(sec % 60)
  return `${m}:${s.toString().padStart(2, '0')}`
}
