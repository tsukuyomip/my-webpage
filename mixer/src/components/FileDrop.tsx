import { useRef, useState } from 'react'

interface Props {
  onFiles: (files: File[]) => void
}

/** Drag & drop zone + file picker for loading audio files. */
export function FileDrop({ onFiles }: Props) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = useState(false)

  const handleFiles = (list: FileList | null) => {
    if (!list) return
    const files = Array.from(list).filter((f) => f.type.startsWith('audio/'))
    if (files.length) onFiles(files)
  }

  return (
    <div
      className={`filedrop${dragging ? ' filedrop--active' : ''}`}
      onDragOver={(e) => {
        e.preventDefault()
        setDragging(true)
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        e.preventDefault()
        setDragging(false)
        handleFiles(e.dataTransfer.files)
      }}
      onClick={() => inputRef.current?.click()}
      role="button"
      tabIndex={0}
    >
      <input
        ref={inputRef}
        type="file"
        accept="audio/*"
        multiple
        hidden
        onChange={(e) => {
          handleFiles(e.target.files)
          e.target.value = ''
        }}
      />
      <span className="filedrop__icon">＋</span>
      <span>音声ファイルをドラッグ&amp;ドロップ / タップして選択</span>
    </div>
  )
}
