import { useEffect, useState } from 'react'

/** Blob を表示する <img>。Object URL の後始末までを持つ。 */
export function BlobImage({ blob, alt }: { blob: Blob; alt: string }) {
  const [url, setUrl] = useState<string>()
  useEffect(() => {
    const u = URL.createObjectURL(blob)
    setUrl(u)
    return () => URL.revokeObjectURL(u)
  }, [blob])
  if (!url) return null
  return <img className="full" src={url} alt={alt} />
}
