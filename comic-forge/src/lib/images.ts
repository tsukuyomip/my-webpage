import type { AssetHash } from './types'

/**
 * 復号した画像の置き場。
 *
 * スクショ 1 枚は復号すると 30MB を超える。素直に全部持つと iOS はタブごと落とす。
 * だから「いま画面に出す大きさ」までしか復号せず、要らなくなったものから捨てる。
 */

interface Entry {
  bitmap: ImageBitmap
  width: number
}

export class ImageStore {
  private cache = new Map<AssetHash, Entry>()
  private loading = new Set<AssetHash>()

  constructor(
    private fetchBlob: (hash: AssetHash) => Promise<Blob | null>,
    private onReady: () => void,
    private limit = 12,
  ) {}

  /** いま持っているものを返す。無ければ裏で用意して、できたら onReady で呼び戻す。 */
  get(hash: AssetHash, wantWidth: number): ImageBitmap | null {
    const hit = this.cache.get(hash)
    // 2 倍まで開いたら取り直す。少し粗いくらいなら拡大して使う（毎フレーム復号しないため）。
    if (hit && hit.width >= wantWidth / 2) return hit.bitmap
    void this.load(hash, wantWidth)
    return hit?.bitmap ?? null
  }

  private async load(hash: AssetHash, wantWidth: number): Promise<void> {
    if (this.loading.has(hash)) return
    this.loading.add(hash)
    try {
      const blob = await this.fetchBlob(hash)
      if (!blob) return
      const bitmap = await decodeAt(blob, wantWidth)
      const old = this.cache.get(hash)
      old?.bitmap.close()
      this.cache.set(hash, { bitmap, width: bitmap.width })
      this.evict()
      this.onReady()
    } catch {
      // 復号に失敗しても編集は続けられる。コマが空に見えるだけ。
    } finally {
      this.loading.delete(hash)
    }
  }

  private evict(): void {
    while (this.cache.size > this.limit) {
      const oldest = this.cache.keys().next().value as AssetHash | undefined
      if (oldest === undefined) return
      this.cache.get(oldest)?.bitmap.close()
      this.cache.delete(oldest)
    }
  }

  dispose(): void {
    for (const e of this.cache.values()) e.bitmap.close()
    this.cache.clear()
  }
}

/** 指定した幅を超えないところまで縮めて復号する。 */
export async function decodeAt(blob: Blob, wantWidth: number): Promise<ImageBitmap> {
  const probe = await createImageBitmap(blob)
  if (probe.width <= wantWidth) return probe
  const w = Math.max(1, Math.round(wantWidth))
  const h = Math.max(1, Math.round((probe.height * w) / probe.width))
  probe.close()
  return createImageBitmap(blob, { resizeWidth: w, resizeHeight: h, resizeQuality: 'high' })
}
