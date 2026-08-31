import { useEffect, useRef, useState } from 'react'
import { getThumb } from '../lib/db'

// サムネの Object URL は使い回す。スクロールで作り直すと、そのたびに読み直しになる。
const urls = new Map<string, Promise<string | null>>()

function thumbUrl(id: string): Promise<string | null> {
  let p = urls.get(id)
  if (!p) {
    p = getThumb(id).then((blob) => (blob ? URL.createObjectURL(blob) : null))
    urls.set(id, p)
  }
  return p
}

export async function releaseThumb(id: string): Promise<void> {
  const p = urls.get(id)
  urls.delete(id)
  const url = await p
  if (url) URL.revokeObjectURL(url)
}

export async function releaseAllThumbs(): Promise<void> {
  const all = [...urls.keys()]
  await Promise.all(all.map(releaseThumb))
}

/** 画面に入ってから IndexedDB を読むサムネ。一覧を開いた瞬間に全件を読むのを避ける。 */
export function Thumb({ id, alt }: { id: string; alt: string }) {
  const ref = useRef<HTMLDivElement>(null)
  const [url, setUrl] = useState<string | null>(null)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    let cancelled = false
    const load = () => {
      thumbUrl(id).then((u) => {
        if (!cancelled) setUrl(u)
      })
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          io.disconnect()
          load()
        }
      },
      { rootMargin: '300px' },
    )
    io.observe(el)
    return () => {
      cancelled = true
      io.disconnect()
    }
  }, [id])

  return (
    <div className="thumb" ref={ref}>
      {url && <img src={url} alt={alt} />}
    </div>
  )
}
