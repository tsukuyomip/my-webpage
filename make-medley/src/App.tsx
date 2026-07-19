import { useEffect, useMemo, useRef, useState } from 'react'
import { decodeFile, toMono } from './audio/decode.ts'
import { analyzeBuffer } from './audio/analyze.ts'
import { buildMedley, type MedleyResult } from './audio/medley.ts'
import { channelsToAudioBuffer } from './audio/toAudioBuffer.ts'
import { encodeWav } from './audio/wav.ts'
import { player, beatGrid } from './audio/player.ts'
import { detectChords, mergeChords, synthChords, type ChordSegment } from './audio/chords.ts'
import { Waveform } from './components/Waveform.tsx'
import type { Analysis, BpmMode, MergeSettings, Track } from './audio/types.ts'

interface UITrack extends Track {
  mono: Float32Array
  duration: number
  viewStart: number
  viewDur: number
  cursor: number
  beatsPerBar: number
  chordSegments?: ChordSegment[]
  chordBuffer?: AudioBuffer
  chordsLoading?: boolean
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
type PlayMode = 'full' | 'segment' | 'chords'

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
  const [outBeatsPerBar, setOutBeatsPerBar] = useState(4)

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
          beatsPerBar: 4,
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
    // 'chords' plays the synthesised chord track (same timeline as the audio).
    const buffer = m === 'chords' ? track.chordBuffer : track.buffer
    if (!buffer) return
    const grid = beatGrid(track.analysis.tempo.bpm, track.analysis.tempo.beatOffset, track.duration)
    const startSec = m === 'segment' ? track.segmentStart : from ?? track.cursor
    player.play({
      buffer,
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

  const analyzeChords = async (track: UITrack) => {
    updateTrack(track.id, { chordsLoading: true })
    await new Promise((r) => setTimeout(r, 20))
    try {
      const grid = beatGrid(
        track.analysis.tempo.bpm,
        track.analysis.tempo.beatOffset,
        track.duration,
      )
      const chords = detectChords(
        track.mono,
        track.buffer.sampleRate,
        grid,
        track.duration,
        track.analysis.key,
      )
      const segments = mergeChords(chords)
      const [L, R] = synthChords(segments, track.duration, track.buffer.sampleRate)
      const chordBuffer = channelsToAudioBuffer([L, R], track.buffer.sampleRate)
      updateTrack(track.id, { chordSegments: segments, chordBuffer, chordsLoading: false })
    } catch (e) {
      updateTrack(track.id, { chordsLoading: false })
      setError(`コード解析に失敗しました: ${(e as Error).message}`)
    }
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
              onBeatsPerBar={(n) => updateTrack(t.id, { beatsPerBar: n })}
              onAnalyzeChords={analyzeChords}
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
              duration={medley.durationSec}
              beatsPerBar={outBeatsPerBar}
            />
            {mode === 'unify' && <TimeSig value={outBeatsPerBar} onChange={setOutBeatsPerBar} />}
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
            beatsPerBar={outBeatsPerBar}
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
  onBeatsPerBar,
  onAnalyzeChords,
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
  onBeatsPerBar: (n: number) => void
  onAnalyzeChords: (track: UITrack) => void
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
        beatsPerBar={track.beatsPerBar}
        segment={{ start: track.segmentStart, end: track.segmentEnd, onChange: onSegment }}
        playhead={playhead}
        onSeek={(t) => onSeek(track, t)}
      />

      {track.chordSegments && (
        <ChordStrip
          segments={track.chordSegments}
          viewStart={track.viewStart}
          viewDur={track.viewDur}
          playhead={playhead}
        />
      )}

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
        <button onClick={() => onAnalyzeChords(track)} disabled={track.chordsLoading}>
          {track.chordsLoading ? 'コード解析中…' : '🎼 コード解析'}
        </button>
        {track.chordBuffer && (
          <button
            className={playing && playMode === 'chords' ? 'active' : ''}
            onClick={() => onToggle(track, 'chords')}
          >
            {playing && playMode === 'chords' ? '⏹' : '🎹'} コードのみ
          </button>
        )}
        <BeatPulse
          active={playing}
          bpm={tempo.bpm}
          offset={tempo.beatOffset}
          position={position}
          duration={track.duration}
          beatsPerBar={track.beatsPerBar}
        />
        <TimeSig value={track.beatsPerBar} onChange={onBeatsPerBar} />
        <TapTempo onEstimate={(bpm) => onTempo(track.id, bpm)} />
        <span className="bpm-editor">
          <label>BPM</label>
          <button onClick={() => onTempo(track.id, tempo.bpm / 2)} title="半分">
            ½
          </button>
          <BpmInput value={tempo.bpm} onCommit={(n) => onTempo(track.id, n)} />
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

/**
 * Chord labels laid out along the same time axis as the waveform (follows zoom
 * and pan). Consecutive equal chords are already merged into one segment.
 */
function ChordStrip({
  segments,
  viewStart,
  viewDur,
  playhead,
}: {
  segments: ChordSegment[]
  viewStart: number
  viewDur: number
  playhead: number
}) {
  const viewEnd = viewStart + viewDur
  return (
    <div className="chord-strip">
      {segments.map((s, i) => {
        if (s.endSec <= viewStart || s.startSec >= viewEnd) return null
        const left = ((s.startSec - viewStart) / viewDur) * 100
        const w = ((s.endSec - s.startSec) / viewDur) * 100
        const active = playhead >= s.startSec && playhead < s.endSec
        return (
          <div
            key={i}
            className={`chord-cell ${s.root < 0 ? 'nc' : ''} ${active ? 'now' : ''}`}
            style={{ left: `${left}%`, width: `${w}%` }}
            title={`${s.label}｜${formatTime(s.startSec)}–${formatTime(s.endSec)}`}
          >
            <span>{s.label}</span>
          </div>
        )
      })}
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

/**
 * BPM field that only commits on blur / Enter, so validation (clamping) does
 * not fight the user mid-typing. It resyncs to the external value whenever that
 * changes from elsewhere (½ / ×2 / tap tempo).
 */
function BpmInput({ value, onCommit }: { value: number; onCommit: (n: number) => void }) {
  const display = () => String(Math.round(value * 10) / 10)
  const [text, setText] = useState(display)
  useEffect(() => {
    setText(String(Math.round(value * 10) / 10))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value])

  const commit = () => {
    const n = Number(text)
    if (isFinite(n) && n > 0) onCommit(n)
    else setText(display()) // revert invalid input
  }

  return (
    <input
      type="number"
      inputMode="decimal"
      min={40}
      max={260}
      step={0.1}
      value={text}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
      }}
    />
  )
}

/**
 * Tap-tempo estimator. BPM is derived from the intervals between taps; a single
 * missed tap is rejected as an outlier (median filter), and a pause longer than
 * RESET_GAP starts a fresh measurement. A reset button clears it manually.
 */
function TapTempo({ onEstimate }: { onEstimate: (bpm: number) => void }) {
  const RESET_GAP = 2500 // ms; a longer pause is treated as a new measurement
  const tapsRef = useRef<number[]>([])
  const [info, setInfo] = useState<{ bpm: number; count: number } | null>(null)

  const tap = () => {
    const now = performance.now()
    const taps = tapsRef.current
    if (taps.length && now - taps[taps.length - 1] > RESET_GAP) taps.length = 0
    taps.push(now)

    if (taps.length >= 3) {
      const intervals: number[] = []
      for (let i = 1; i < taps.length; i++) intervals.push(taps[i] - taps[i - 1])
      const sorted = [...intervals].sort((a, b) => a - b)
      const med = sorted[Math.floor(sorted.length / 2)]
      // Keep only intervals near the median so a forgotten tap (≈2× interval)
      // does not drag the estimate.
      const good = intervals.filter((iv) => Math.abs(iv - med) <= med * 0.4)
      const avg = good.reduce((a, b) => a + b, 0) / good.length
      const bpm = 60000 / avg
      if (isFinite(bpm) && bpm > 0) {
        setInfo({ bpm, count: taps.length })
        onEstimate(bpm)
      }
    } else {
      setInfo({ bpm: 0, count: taps.length })
    }
  }

  const reset = () => {
    tapsRef.current = []
    setInfo(null)
  }

  return (
    <span className="tap-tempo">
      <button className="tap-btn" onClick={tap} title="曲に合わせてタップ">
        TAP
      </button>
      <button className="tap-reset" onClick={reset} title="タップをリセット">
        ↺
      </button>
      <span className="tap-info">
        {info == null
          ? 'タップで計測'
          : info.count < 3
            ? `${info.count} tap…`
            : `${info.bpm.toFixed(1)} BPM`}
      </span>
    </span>
  )
}

/** Time-signature input: the beats-per-bar numerator, denominator fixed to 4. */
function TimeSig({ value, onChange }: { value: number; onChange: (n: number) => void }) {
  return (
    <span className="timesig" title="1小節あたりの拍数（拍子の分子）。分母は4分音符固定">
      <input
        type="number"
        min={1}
        max={16}
        value={value}
        onChange={(e) => onChange(Math.max(1, Math.min(16, Math.round(Number(e.target.value) || 4))))}
      />
      <span>/4拍子</span>
    </span>
  )
}

/**
 * A heart that pulses on every beat while playing — a visual BPM preview —
 * with an "n/N" readout of which beat sounded and its bar:beat position given
 * the time signature (beatsPerBar / 4).
 */
function BeatPulse({
  active,
  bpm,
  offset,
  position,
  duration,
  beatsPerBar,
}: {
  active: boolean
  bpm: number
  offset: number
  position: number
  duration: number
  beatsPerBar: number
}) {
  let scale = 1
  let n = 0
  let total = 0
  if (bpm > 0 && duration > 0) {
    const period = 60 / bpm
    total = Math.max(0, Math.floor((duration - offset) / period) + 1)
    if (active) {
      const since = ((position - offset) % period + period) % period
      scale = 1 + 0.6 * Math.exp(-since / (period * 0.3))
      n = position >= offset ? Math.min(total, Math.floor((position - offset) / period) + 1) : 0
    }
  }
  const bar = n > 0 ? Math.floor((n - 1) / beatsPerBar) + 1 : 0
  const beatInBar = n > 0 ? ((n - 1) % beatsPerBar) + 1 : 0
  return (
    <span className="beat-meter">
      <span
        className={`beat-pulse ${active ? 'on' : ''}`}
        style={{ transform: `scale(${scale.toFixed(3)})` }}
        title={active ? `${Math.round(bpm)} BPM` : '再生すると拍が脈打ちます'}
      >
        ❤️
      </span>
      {active && total > 0 && (
        <span className="beat-count" title="今鳴った拍 / 全拍数 ・ 何小節目の何拍目か">
          {n}/{total}
          <span className="bar-beat">
            {bar}小節{beatInBar}拍
          </span>
        </span>
      )}
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
