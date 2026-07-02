import { useEffect, useState } from 'react'

/** <img> backed by a Blob, managing the object URL lifecycle. */
export function BlobImage({ blob, alt, className }: { blob: Blob; alt: string; className?: string }) {
  const [url, setUrl] = useState<string>()
  useEffect(() => {
    const u = URL.createObjectURL(blob)
    setUrl(u)
    return () => URL.revokeObjectURL(u)
  }, [blob])
  if (!url) return null
  return <img src={url} alt={alt} className={className} loading="lazy" />
}
