import { BUILD } from './defaults'

/**
 * 動いているページが古いままになっていないか。
 *
 * ホーム画面に追加した Web アプリは、アイコンを押しても前の状態から再開することがあり、
 * 新しいデプロイの index.html を取りに行かない。直したはずのものが端末に届かず、
 * 「まだ直っていない」という形でだけ現れる。実際にそれで一往復した。
 *
 * だから刻印だけを別ファイルで読み比べ、**目立つところに出して、その場で入れ替えられる**
 * ようにする。メニューの奥の 1 行では見落とす。
 */
export async function fetchDeployedBuild(): Promise<string | null> {
  try {
    // 古い service worker はキャッシュ優先で拾うので、毎回ちがう URL にして避ける。
    const url = `${import.meta.env.BASE_URL}version.json?t=${Date.now()}`
    const res = await fetch(url, { cache: 'no-store' })
    if (!res.ok) return null
    const data: unknown = await res.json()
    const build = (data as { build?: unknown }).build
    return typeof build === 'string' ? build : null
  } catch {
    // 網に出られないだけ。動作は変わらないので黙って諦める。
    return null
  }
}

/** 配られている版と食い違っているか。 */
export async function isStale(): Promise<boolean> {
  if (BUILD === 'dev') return false
  const deployed = await fetchDeployedBuild()
  return !!deployed && deployed !== BUILD
}

/**
 * 溜め込んだものを捨てて読み直す。
 *
 * service worker とそのキャッシュを外してから読み直さないと、
 * ホーム画面のアプリは何度開き直しても古い版のままになる。
 * 作品は IndexedDB にあるので、ここで消えるのは配信物だけ。
 */
export async function forceUpdate(): Promise<void> {
  try {
    if ('serviceWorker' in navigator) {
      const regs = await navigator.serviceWorker.getRegistrations()
      await Promise.all(regs.map((r) => r.unregister()))
    }
  } catch {
    /* 外せなくても、下のキャッシュ削除と再読み込みは試す */
  }
  try {
    if ('caches' in window) {
      const keys = await caches.keys()
      await Promise.all(keys.map((k) => caches.delete(k)))
    }
  } catch {
    /* 同上 */
  }
  location.reload()
}
