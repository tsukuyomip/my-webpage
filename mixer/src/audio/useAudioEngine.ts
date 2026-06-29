import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { AudioEngine } from './AudioEngine'

/** Hold a single AudioEngine instance for the lifetime of the component. */
export function useAudioEngine(): {
  engine: AudioEngine
  snapshot: ReturnType<AudioEngine['getSnapshot']>
} {
  const ref = useRef<AudioEngine | null>(null)
  if (ref.current === null) ref.current = new AudioEngine()
  const engine = ref.current

  const snapshot = useSyncExternalStore(engine.subscribe, engine.getSnapshot)
  return { engine, snapshot }
}

/**
 * Track the live transport position via requestAnimationFrame while playing.
 * Kept separate from the structural snapshot so per-frame updates don't churn
 * the whole tree.
 */
export function useTransportPosition(engine: AudioEngine, isPlaying: boolean): number {
  const [position, setPosition] = useState(0)

  useEffect(() => {
    let raf = 0
    const tick = () => {
      setPosition(engine.position)
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
    // Re-arm when play state flips so the playhead also settles after pause/seek.
  }, [engine, isPlaying])

  return position
}
