import { useEffect, useMemo, useRef, useState } from 'react'
import { decodeFile, getAudioContext } from './audio/decode.ts'
import { analyzeBuffer } from './audio/analyze.ts'
import { computePeaks, type Peaks } from './audio/peaks.ts'
import { buildMedley, type MedleyResult } from './audio/medley.ts'
import { channelsToAudioBuffer } from './audio/toAudioBuffer.ts'
import { encodeWav } from './audio/wav.ts'
import { Waveform } from './components/Waveform.tsx'
import type { BpmMode, MergeSettings, Track } from './audio/types.ts'

interface UITrack extends Track {
  peaks: Peaks
}

const PEAK_COLUMNS = 900

function median(values: number[]): number {
  if (values.length === 0) return 120
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

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

  const [medley, setMedley] = useState<MedleyResult | null>(null)
  const [medleyBuffer, setMedleyBuffer] = useState<AudioBuffer | null>(null)
  const [playing, setPlaying] = useState(false)
  const [playhead, setPlayhead] = useState(0)
  const playRef = useRef<{ src: AudioBufferSourceNode; startedAt: number } | null>(null)

  // Auto-suggest a target BPM from detected tempos until the user overrides it.
  useEffect(() => {
    if (!targetTouched && tracks.length > 0) {
      setTargetBpm(Math.round(median(tracks.map((t) => t.analysis.tempo.bpm))))
    }
  }, [tracks, targetTouched])

  const onFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return
    setError(null)
    for (const file of Array.from(files)) {
      setLoading(file.name)
      // Yield so the loading label paints before the synchronous DSP runs.
      await new Promise((r) => setTimeout(r, 10))
      try {
        const buffer = await decodeFile(file)
        const analysis = analyzeBuffer(buffer)
        const peaks = computePeaks(buffer, PEAK_COLUMNS)
        const track: UITrack = {
          id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          name: file.name.replace(/\.[^.]+$/, ''),
          buffer,
          analysis,
          segmentStart: 0,
          segmentEnd: buffer.duration,
          peaks,
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

  const removeTrack = (id: string) => setTracks((prev) => prev.filter((t) => t.id !== id))

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

  const build = async () => {
    if (tracks.length === 0) return
    stop()
    setBuilding(true)
    setError(null)
    setMedley(null)
    setMedleyBuffer(null)
    await new Promise((r) => setTimeout(r, 20))
    try {
      const result = buildMedley(tracks, settings)
      const buffer = channelsToAudioBuffer(result.channels, result.sampleRate)
      setMedley(result)
      setMedleyBuffer(buffer)
    } catch (e) {
      setError(`メドレー生成に失敗しました: ${(e as Error).message}`)
    } finally {
      setBuilding(false)
    }
  }

  const stop = () => {
    if (playRef.current) {
      try {
        playRef.current.src.onended = null
        playRef.current.src.stop()
      } catch {
        /* already stopped */
      }
      playRef.current = null
    }
    setPlaying(false)
  }

  const play = () => {
    if (!medleyBuffer) return
    stop()
    const ctx = getAudioContext()
    void ctx.resume()
    const src = ctx.createBufferSource()
    src.buffer = medleyBuffer
    src.connect(ctx.destination)
    src.onended = () => {
      setPlaying(false)
      playRef.current = null
    }
    src.start()
    playRef.current = { src, startedAt: ctx.currentTime }
    setPlaying(true)
  }

  // Playhead animation.
  useEffect(() => {
    if (!playing) return
    let raf = 0
    const tick = () => {
      if (playRef.current) {
        const ctx = getAudioContext()
        setPlayhead(ctx.currentTime - playRef.current.startedAt)
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [playing])

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
            accept="audio/*"
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
        <section className="tracks">
          <h2>トラック（上から順に繋がります）</h2>
          {tracks.map((t, i) => (
            <TrackCard
              key={t.id}
              track={t}
              index={i}
              total={tracks.length}
              onMove={moveTrack}
              onRemove={removeTrack}
              onSegment={(s, e) => updateTrack(t.id, { segmentStart: s, segmentEnd: e })}
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

      {medley && medleyBuffer && (
        <section className="result">
          <h2>プレビュー</h2>
          <div className="player">
            <button onClick={playing ? stop : play}>{playing ? '⏹ 停止' : '▶️ 再生'}</button>
            <button onClick={download}>⬇️ WAV を書き出し</button>
            <span className="duration">
              {formatTime(playing ? playhead : 0)} / {formatTime(medley.durationSec)}
            </span>
          </div>
          <SectionTimeline
            sections={medley.sections}
            duration={medley.durationSec}
            playhead={playing ? playhead : 0}
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
  onMove,
  onRemove,
  onSegment,
}: {
  track: UITrack
  index: number
  total: number
  onMove: (id: string, dir: -1 | 1) => void
  onRemove: (id: string) => void
  onSegment: (start: number, end: number) => void
}) {
  const { tempo, key } = track.analysis
  return (
    <div className="track-card">
      <div className="track-head">
        <span className="track-index">{index + 1}</span>
        <span className="track-name">{track.name}</span>
        <span className="badge">🥁 {tempo.bpm} BPM</span>
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
      <Waveform
        peaks={track.peaks}
        bpm={tempo.bpm}
        beatOffset={tempo.beatOffset}
        segmentStart={track.segmentStart}
        segmentEnd={track.segmentEnd}
        onChangeSegment={onSegment}
      />
      <div className="track-foot">
        使用区間: {formatTime(track.segmentStart)} – {formatTime(track.segmentEnd)}（ハンドルをドラッグで調整）
      </div>
    </div>
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
