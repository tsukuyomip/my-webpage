/**
 * クリップボードから画像を取り出す。
 *
 * **なぜ要るか。** iOS の共有シートに Web アプリは出せない（Web Share Target は
 * Android の Chrome だけで、Safari は実装していない）。だから「写真アプリから
 * 直接 Shot Bank へ」は、そのままでは作れない。
 *
 * 代わりに、共有シートに出せる**ショートカット**を経由する:
 *
 *     写真アプリ → 共有 → ［Shot Bank に追加］
 *       ショートカット: 画像をクリップボードにコピー → Shot Bank を開く
 *     → アプリで「貼り付け」
 *
 * paste イベントだけでは足りない。iOS には ⌘V が無く、貼り付けの吹き出しは
 * 文字を入れる場所にしか出ないので、**押せるボタンから読みにいく**必要がある。
 */

/** この環境でクリップボードから読めるか。 */
export function canReadClipboard(): boolean {
  return typeof navigator !== 'undefined' && typeof navigator.clipboard?.read === 'function'
}

export type ClipboardResult =
  | { kind: 'files'; files: File[] }
  /** 読めたが画像が無かった */
  | { kind: 'empty' }
  /** 許可されなかった。iOS は読むたびに確認を出す */
  | { kind: 'denied' }
  /** この環境では読めない */
  | { kind: 'unsupported' }

/**
 * クリップボードの画像をぜんぶ File にする。
 *
 * ユーザの操作から地続きで呼ぶこと。iOS は読むたびに「ペーストを許可しますか」を
 * 出すので、押した流れの中でないと弾かれる。
 */
export async function readClipboardImages(): Promise<ClipboardResult> {
  if (!canReadClipboard()) return { kind: 'unsupported' }
  let items: ClipboardItem[]
  try {
    items = await navigator.clipboard.read()
  } catch {
    // 許可しなかったときも、読めない環境でも同じ例外で来る。
    // どちらも「押し直せばいい」で済むので分けない。
    return { kind: 'denied' }
  }

  const files: File[] = []
  for (const [i, item] of items.entries()) {
    // 同じ絵が png と別の形で入っていることがある。画像は 1 つだけ採る。
    const type = item.types.find((t) => t.startsWith('image/'))
    if (!type) continue
    try {
      const blob = await item.getType(type)
      files.push(new File([blob], clipboardName(i, type), { type }))
    } catch {
      // 1 つ読めなくても、残りは取り込む。
    }
  }
  return files.length ? { kind: 'files', files } : { kind: 'empty' }
}

/**
 * クリップボードの絵には名前が無い。
 * 取り込んだ順が分かる名前を付ける ── 元の名前（IMG_5922）はどのみち残らない。
 */
function clipboardName(index: number, type: string): string {
  const ext = type.split('/')[1]?.split('+')[0] ?? 'png'
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  const stamp = `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`
  return `clip-${stamp}-${index + 1}.${ext}`
}
