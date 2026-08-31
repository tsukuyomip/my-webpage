/**
 * 配られている版の刻印を読む。
 *
 * ホーム画面のアプリは、アイコンを押しても前の状態から再開することがあり、
 * 新しいデプロイの index.html を取りに行かない。実機で、直したはずのものが
 * 何時間たっても届いていなかった（名簿の種入れが走っていなかった）。
 * 動いているページが「自分は古い」と気づけるように、刻印だけを別に読み比べる。
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
