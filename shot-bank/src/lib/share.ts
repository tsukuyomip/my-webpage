import { getImage } from './db'
import { extensionFor } from './encode'
import { stamp, stampNow } from './format'
import { squeezeJapaneseSpaces } from './plausible'
import { formatStory } from './story'
import type { Character, Shot } from './types'
import { makeZip } from './zip'

/**
 * 選んだ枚を LINE へ送る。
 *
 * 送り口はブラウザの共有シート（navigator.share）ひとつ。LINE へ直接投げる API は
 * 個人のページからは叩けないし、叩けたとしても宛先を選ぶのは結局ユーザなので、
 * OS の共有シートに渡すのがいちばん短い。iOS なら共有先に LINE が並ぶ。
 *
 * 共有が使えない環境（PC のブラウザなど）では ZIP に落とす。
 * 「送れません」で行き止まりにせず、手で渡す道は必ず残す。
 */

/** 共有シートにファイルを渡せるか。iOS Safari は可、PC の多くは不可。 */
export function canShareFiles(files: File[]): boolean {
  if (typeof navigator === 'undefined' || !navigator.canShare || !navigator.share) return false
  try {
    return navigator.canShare({ files })
  } catch {
    return false
  }
}

/**
 * 送るときの目安。
 *
 * **どちらもまだ実機で測っていない見当**。共有シートは枚数ではなく、渡す総量で
 * 詰まることが多い（スクショ 1 枚が 2〜4MB あるので、20 枚で 60MB を超える）。
 * 止めはせずに但し書きを出すだけにして、実機で詰まる枚数が分かったら合わせる。
 */
export const SHARE_WARN_COUNT = 12
export const SHARE_WARN_BYTES = 50 * 1024 * 1024

export interface ShareSize {
  count: number
  bytes: number
  /** 多すぎて共有シートが受け取らないかもしれない */
  heavy: boolean
}

export function shareSize(shots: Shot[]): ShareSize {
  const bytes = shots.reduce((sum, s) => sum + s.size, 0)
  return {
    count: shots.length,
    bytes,
    heavy: shots.length > SHARE_WARN_COUNT || bytes > SHARE_WARN_BYTES,
  }
}

/** 保存してある画像を File にして取り出す。共有シートは Blob ではなく File を要る。 */
export async function filesFor(shots: Shot[], roster: Character[] = []): Promise<File[]> {
  const byId = new Map(roster.map((c) => [c.id, c]))
  const files: File[] = []
  const used = new Set<string>()
  for (const shot of shots) {
    const blob = await getImage(shot.id)
    if (!blob) continue
    files.push(new File([blob], unique(shareName(shot, byId.get(shot.speakerId ?? '')), used), {
      type: shot.mime,
    }))
  }
  return files
}

/**
 * 同じ名前が並ばないようにする。
 * 同じ人の同じ話数は普通にあるので（連続したセリフ）、そのままだと全部同名になる。
 */
function unique(name: string, used: Set<string>): string {
  if (!used.has(name)) {
    used.add(name)
    return name
  }
  const dot = name.lastIndexOf('.')
  const stem = dot > 0 ? name.slice(0, dot) : name
  const ext = dot > 0 ? name.slice(dot) : ''
  for (let i = 2; ; i++) {
    const candidate = `${stem}-${i}${ext}`
    if (!used.has(candidate)) {
      used.add(candidate)
      return candidate
    }
  }
}

/**
 * 送るときのファイル名。
 *
 * 元のファイル名（IMG_5922.PNG）は、受け取った側に何も伝えない。
 * 誰の何話かが分かる名前にしておくと、LINE のトーク上でも見分けが付く。
 */
export function shareName(shot: Shot, speaker?: Character): string {
  const parts = [speaker?.name ?? shot.speakerRaw, shot.story ? formatStory(shot.story) : '']
    .map((p) => (p ?? '').trim())
    .filter(Boolean)
  // 何も分からない枚は日付にする。id（0mthx2y6）は受け取った側に何も伝えない。
  // 撮った日時が分かればそれを、無ければ取り込んだ日時を使う。
  const stem = parts.length
    ? parts.join('-').replace(/[\\/:*?"<>|\s]+/g, '_')
    : stamp(shot.shotAt ?? shot.createdAt)
  return `${stem}.${extensionFor(shot.mime)}`
}

/**
 * 保存（ダウンロード）に使う名前。
 *
 * **Chromium は a.download に ASCII 以外が 1 文字でも入っていると、名前ごと捨てる。**
 * 拡張子まで消えて `download` になり、OS がその絵を開けなくなる。
 * 実測（画面ありでも同じ。ヘッドレスのせいではない）:
 *
 *     "ことね.jpg"        → "download"
 *     "kotone-ことね.jpg" → "download"
 *     "café.jpg"          → "download"
 *     "a_b-c.jpg"         → "a_b-c.jpg"
 *
 * 名前と拡張子のどちらかを諦めるなら、拡張子を採る。名前は日付にすれば
 * 「いつ撮ったか」は残るが、拡張子が無い絵は開くことすらできない。
 *
 * 共有シートへ渡すぶんは File が名前を持っていくので、この制限を受けない。
 * だから shareName はそのまま日本語で、ここだけ ASCII に寄せる。
 */
export function downloadName(shot: Shot, speaker?: Character): string {
  const name = shareName(shot, speaker)
  if (/^[\x20-\x7E]+$/.test(name)) return name
  return `${stamp(shot.shotAt ?? shot.createdAt)}.${extensionFor(shot.mime)}`
}

/** 本文を 1 行に均す。改行はセリフの折り返しなので、つないで空白を詰め直す。 */
function oneLine(body: string): string {
  return squeezeJapaneseSpaces(body.replace(/\s*\n\s*/g, ' ')).trim()
}

/**
 * 選んだ枚のセリフを、そのまま貼れる形にする。
 *
 * 画像と一緒に text を渡す手もあるが、**やらない**。実機で確認したところ、
 * LINE は付けた文字列をそのまま本文として送る（title に「3 枚」と入れていたら
 * それが 1 通のメッセージになった）。セリフを常に付けると、要らないときも
 * 相手のトークに流れてしまう。
 *
 * だから「送る」は画像だけ、セリフが要るときは「セリフをコピー」で自分で貼る。
 * 送るかどうかを決めるのは受け取る相手を知っている人のほうがよい。
 */
export function dialogueText(shots: Shot[], roster: Character[]): string {
  const byId = new Map(roster.map((c) => [c.id, c]))
  return shots
    .map((shot) => {
      const name = (shot.speakerId ? byId.get(shot.speakerId)?.name : null) ?? shot.speakerRaw ?? ''
      const story = shot.story ? formatStory(shot.story) : ''
      const head = [name, story].filter(Boolean).join(' · ')
      const body = oneLine(shot.body ?? '')
      // 見出しだけ、本文だけ、どちらも空、のいずれもありうる
      return [head && `【${head}】`, body].filter(Boolean).join('\n')
    })
    .filter(Boolean)
    .join('\n\n')
}

export type ShareOutcome = 'shared' | 'cancelled' | 'unsupported' | 'empty'

/**
 * 共有シートを開く。
 *
 * **渡すのは files だけ。** title も text も付けない。以前は title に「3 枚」と
 * 入れていたら、LINE がそれを本文として一緒に送っていた（実機で確認）。
 * 送り先はトークなので、要らない一言が混ざるのはそのまま相手に見える。
 *
 * ユーザの操作から地続きで呼ばないと、ブラウザに拒まれる（await を挟んだあとでも
 * 同じ操作の続きとみなされる実装が多いが、余計な確認は挟まない）。
 * 取り消しは失敗ではないので、そう見えるようにして返す。
 */
export async function shareFiles(files: File[]): Promise<ShareOutcome> {
  if (!files.length) return 'empty'
  if (!canShareFiles(files)) return 'unsupported'
  try {
    await navigator.share({ files })
    return 'shared'
  } catch (e) {
    // 取り消しは AbortError で来る。それ以外は環境の都合とみなして ZIP へ誘導する。
    if (e instanceof DOMException && e.name === 'AbortError') return 'cancelled'
    return 'unsupported'
  }
}

/**
 * 共有シートが使えないときの逃げ道。選んだ枚だけを ZIP にする。
 *
 * バックアップ（exportBackup）とは別物。あちらは戻すための manifest つきで、
 * こちらは人に渡すためのただの画像の束。混ぜると、渡した相手に
 * 要らない JSON が付いていく。
 */
export async function zipFor(shots: Shot[], roster: Character[] = []): Promise<Blob> {
  const files = await filesFor(shots, roster)
  return makeZip(files.map((f) => ({ path: f.name, blob: f })))
}

export function zipName(): string {
  return `shot-bank-${stampNow()}.zip`
}
