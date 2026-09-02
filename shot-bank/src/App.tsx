import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Banners } from './components/Banners'
import { DetailSheet } from './components/DetailSheet'
import { DuplicatePanel, type DuplicateChoice } from './components/DuplicatePanel'
import { FilterBar } from './components/FilterBar'
import { RosterPanel } from './components/RosterPanel'
import { SearchBar } from './components/SearchBar'
import { SettingsPanel } from './components/SettingsPanel'
import { SelectionTray } from './components/SelectionTray'
import { ShotGrid } from './components/ShotGrid'
import { TagQueue } from './components/TagQueue'
import { releaseThumb } from './components/Thumb'
import {
  deleteCharacter,
  deleteShot,
  getAllCharacters,
  getAllShots,
  getImage,
  loadSettings,
  putCharacter,
  saveSettings,
  updateShot,
} from './lib/db'
import { canReadClipboard, readClipboardImages } from './lib/clipboardImages'
import { embedFace } from './lib/embed'
import { saveBlob } from './lib/download'
import { applyFacets, collectTags, EMPTY_FACETS, type Facets } from './lib/filter'
import { normalizeName, withColorSample } from './lib/names'
import {
  imageFilesFrom,
  ingestFiles,
  type DuplicateFile,
  type IngestProgress,
} from './lib/ingest'
import { allMoods } from './lib/moods'
import { needsOcr, recognizeShots, type RecognizeProgress } from './lib/recognizeQueue'
import { toPixels } from './lib/ocr'
import { gakumas } from './lib/profiles/gakumas'
import { mergeCharacters, repointShot, resolveSpeakers, seedRoster } from './lib/roster'
import { dialogueText, downloadName, filesFor, shareFiles, zipFor, zipName } from './lib/share'
import { autoAssign } from './lib/suggest'
import { isIOS, isStandalone, requestPersistence } from './lib/storage'
import { fetchDeployedBuild } from './lib/version'
import {
  DEFAULT_SETTINGS,
  type Character,
  type Face,
  type Settings,
  type Shot,
} from './lib/types'

export default function App() {
  const [shots, setShots] = useState<Shot[]>([])
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS)
  const [selected, setSelected] = useState<Shot | null>(null)
  const [showSettings, setShowSettings] = useState(false)
  const [progress, setProgress] = useState<IngestProgress | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [notice, setNotice] = useState<string>()
  const [dragging, setDragging] = useState(false)
  const [roster, setRoster] = useState<Character[]>([])
  const [facets, setFacets] = useState<Facets>(EMPTY_FACETS)
  const [showRoster, setShowRoster] = useState(false)
  const [tagging, setTagging] = useState(false)
  const [reading, setReading] = useState<RecognizeProgress | null>(null)
  const [staleBuild, setStaleBuild] = useState(false)
  const [duplicates, setDuplicates] = useState<DuplicateFile[]>([])
  const [selecting, setSelecting] = useState(false)
  const [pickedIds, setPickedIds] = useState<Set<string>>(new Set())
  const fileInput = useRef<HTMLInputElement>(null)
  const stopReading = useRef(false)

  const reload = useCallback(async () => {
    const [all, chars] = await Promise.all([getAllShots(), getAllCharacters()])
    all.sort((a, b) => b.createdAt - a.createdAt || (a.id < b.id ? 1 : -1))
    setShots(all)
    setRoster(chars)
  }, [])

  /**
   * 分かっている主要キャラを名簿に入れる。
   *
   * 入れるのは一覧が増えたときだけ。毎回入れ直すと、名簿の画面で消した人が
   * 起動のたびに戻ってきてしまう。
   */
  const seedKnownNames = useCallback(
    async (current: Settings, force = false) => {
      const known = gakumas.knownCharacters
      const before = await getAllCharacters()
      // 旗だけを見ていると、全消しのあとに種入れが飛ばされる。
      // 全消しはスクショと名簿を消すが設定は残すので、旗は立ったままになる（実測）。
      // 名簿が空なら、消した人を蘇らせる心配もないので入れ直してよい。
      if (!force && current.rosterSeed === gakumas.seedVersion && before.length > 0) return current
      // promoted は「仮」を外した人と、**色を入れ直した人**の両方。
      // 色は実測して少しずつ直しているので、種の版を上げるたびにここで届く。
      const { added, promoted } = seedRoster(before, known)
      for (const character of [...added, ...promoted]) await putCharacter(character)
      const next = { ...current, rosterSeed: gakumas.seedVersion }
      await saveSettings(next)
      if (added.length || promoted.length) await reload()
      if (force) {
        setNotice(
          added.length || promoted.length
            ? `${added.length} 人を足して、${promoted.length} 人を直しました`
            : '足りない人はいませんでした',
        )
      }
      return next
    },
    [reload],
  )

  useEffect(() => {
    void reload()
    void loadSettings()
      .then(async (loaded) => setSettings(await seedKnownNames(loaded)))
      .catch(() => setSettings(DEFAULT_SETTINGS))
    // 配られている版と読み比べる。画面に戻ってくるたびに見直す。
    const checkBuild = async () => {
      const deployed = await fetchDeployedBuild()
      if (deployed) setStaleBuild(deployed !== __BUILD_INFO__)
    }
    void checkBuild()
    const onVisible = () => {
      if (document.visibilityState === 'visible') void checkBuild()
    }
    document.addEventListener('visibilitychange', onVisible)
    // 保存領域を消されにくくする。断られても動作は変わらないので結果は見ない。
    void requestPersistence()
    if (import.meta.env.PROD && 'serviceWorker' in navigator) {
      const base = import.meta.env.BASE_URL
      void navigator.serviceWorker.register(`${base}sw.js`, { scope: base }).catch(() => {})
    }
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [reload])

  // 取り込み結果の知らせは読めば用済みなので、しばらくしたら引っ込める。
  useEffect(() => {
    if (!notice) return
    const t = setTimeout(() => setNotice(undefined), 8000)
    return () => clearTimeout(t)
  }, [notice])

  const updateSettings = useCallback((next: Settings) => {
    setSettings(next)
    void saveSettings(next)
  }, [])

  /**
   * 未認識のものを読む。1 枚読むごとにメタだけ書き戻し、途中で閉じても
   * そこまでの結果が残るようにする。
   */
  const readShots = useCallback(
    async (targets: Shot[]) => {
      if (targets.length === 0) return
      stopReading.current = false
      setReading({ done: 0, total: targets.length, detail: '' })
      const result = await recognizeShots(targets, {
        onProgress: setReading,
        onDone: (shot) => updateShot(shot),
        shouldStop: () => stopReading.current,
      })
      setReading(null)

      // 読めた話者名を名簿へ寄せる。無ければ仮登録する。
      // 名簿は OCR から育つので、ここが唯一の増え口になる。
      const fresh = await getAllShots()
      const current = await getAllCharacters()
      const resolved = resolveSpeakers(fresh, current)
      for (const c of resolved.roster) await putCharacter(c)
      for (const shot of fresh) {
        const id = resolved.assignments.get(shot.id)
        if (id && shot.speakerId !== id) await updateShot({ ...shot, speakerId: id })
      }
      // 話者が決まったところで、顔にも仮の名前を振る。
      // 話者が読めていて顔が 1 つなら、その人。ここで見本が溜まりはじめる。
      await applyAutoAssign()
      await reload()
      if (result.stopped) setNotice('読み取りを止めました')
      else if (result.failed) setNotice(`${result.done} 枚を読み取り、${result.failed} 枚は失敗しました`)
      else if (result.done) setNotice(`${result.done} 枚を読み取りました`)
    },
    [reload],
  )

  /**
   * 「同じ絵がある」1 件を、選ばれたとおりに片付ける。
   * 取り込むほうは重複判定を通さない（もう見比べたあとなので）。
   */
  const resolveDuplicate = useCallback(
    async (item: DuplicateFile, choice: DuplicateChoice) => {
      const drop = choice === 'new' || choice === 'neither'
      const take = choice === 'new' || choice === 'both'
      if (drop) {
        await releaseThumb(item.existingId)
        await deleteShot(item.existingId)
      }
      let taken: Shot[] = []
      if (take) {
        const r = await ingestFiles([item.file], { reencode: settings.reencode, known: [] })
        taken = r.added
      }
      await reload()
      if (settings.autoOcr && taken.length) await readShots(taken)
    },
    [settings.reencode, settings.autoOcr, reload, readShots],
  )

  /**
   * 話者を手で決める。
   *
   * 読み取りは同じ絵でも当たり外れがある。名前が一度も読めないキャラは、
   * 色を覚える機会がないので色でも拾えない（実機で「清夏」がそうなった）。
   * ここで教えてもらった色を名簿に覚えさせ、その場で他の枚にも当て直す。
   * 読み直しは要らない ── 必要なのは色の対応づけだけなので。
   */
  const setSpeaker = useCallback(
    async (shot: Shot, characterId: string | null) => {
      await updateShot({
        ...shot,
        speakerId: characterId ?? undefined,
        speakerPicked: characterId ? true : undefined,
      })
      // 教わった色は必ず足す。種の色と場面が違えば別の色として溜まる
      //（実測: 星南は明るい部屋と暗い場面で 24 離れた）。
      const person = characterId ? roster.find((c) => c.id === characterId) : undefined
      const grown = person ? withColorSample(person, shot.speakerChipColor) : undefined
      const learned = Boolean(grown && grown !== person)
      if (person && grown) {
        await putCharacter({ ...grown, provisional: false })
      }

      const fresh = await getAllShots()
      const resolved = resolveSpeakers(fresh, await getAllCharacters())
      for (const c of resolved.roster) await putCharacter(c)
      let linked = 0
      for (const s of fresh) {
        const id = resolved.assignments.get(s.id)
        if (id && s.speakerId !== id) {
          await updateShot({ ...s, speakerId: id })
          linked++
        }
      }
      await reload()
      if (learned && linked) {
        setNotice(`「${person?.name}」の色を覚えました。同じ色の ${linked} 枚も紐付けました`)
      } else if (learned) {
        setNotice(`「${person?.name}」の色を覚えました`)
      } else if (linked) {
        setNotice(`${linked} 枚を紐付けました`)
      }
    },
    [roster, reload],
  )

  const importFiles = useCallback(
    async (files: File[]) => {
      if (files.length === 0) return
      setNotice(undefined)
      const result = await ingestFiles(files, {
        reencode: settings.reencode,
        known: shots.map((s) => ({ id: s.id, dhash: s.dhash })),
        onProgress: setProgress,
      })
      setProgress(null)
      await reload()

      const parts: string[] = []
      if (result.added.length) parts.push(`${result.added.length} 枚を取り込みました`)
      if (result.duplicates.length) parts.push(`${result.duplicates.length} 枚は同じ絵でした`)
      if (result.failed.length) parts.push(`${result.failed.length} 枚は読めませんでした`)
      setNotice(parts.join(' / ') || '取り込めるものがありませんでした')

      if (settings.autoOcr && result.added.length) await readShots(result.added)
      // どちらを残すかは訊いてから決める。訊かない設定なら、これまでどおり飛ばしたまま。
      if (settings.confirmDuplicates !== false && result.duplicates.length) {
        setDuplicates(result.duplicates)
      }
    },
    [settings.reencode, settings.autoOcr, settings.confirmDuplicates, shots, reload, readShots],
  )

  // ペーストと、ウィンドウ全体へのドロップを受ける。
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const files = imageFilesFrom(e.clipboardData?.files)
      if (files.length) {
        e.preventDefault()
        void importFiles(files)
      }
    }
    const onDragOver = (e: DragEvent) => {
      if (!e.dataTransfer?.types.includes('Files')) return
      e.preventDefault()
      setDragging(true)
    }
    const onDragLeave = (e: DragEvent) => {
      if (e.relatedTarget === null) setDragging(false)
    }
    const onDrop = (e: DragEvent) => {
      e.preventDefault()
      setDragging(false)
      void importFiles(imageFilesFrom(e.dataTransfer?.files))
    }
    window.addEventListener('paste', onPaste)
    window.addEventListener('dragover', onDragOver)
    window.addEventListener('dragleave', onDragLeave)
    window.addEventListener('drop', onDrop)
    return () => {
      window.removeEventListener('paste', onPaste)
      window.removeEventListener('dragover', onDragOver)
      window.removeEventListener('dragleave', onDragLeave)
      window.removeEventListener('drop', onDrop)
    }
  }, [importFiles])

  /**
   * クリップボードの画像を取り込む。
   *
   * iOS の共有シートに Web アプリは出せないので、ショートカット経由で来る道の
   * 受け口。押した流れの中で読まないと、iOS の許可の確認で弾かれる。
   */
  const pasteFromClipboard = useCallback(async () => {
    const r = await readClipboardImages()
    if (r.kind === 'files') {
      await importFiles(r.files)
      return
    }
    if (r.kind === 'empty') setNotice('クリップボードに画像がありませんでした')
    else if (r.kind === 'denied') setNotice('貼り付けを許可されませんでした。もう一度どうぞ')
    else setNotice('この環境ではクリップボードから読めません')
  }, [importFiles])

  /**
   * ショートカットから来たか。
   *
   * 共有シートのショートカットは「コピー → URL を開く」までしかできないので、
   * 最後のひと押しはアプリ側で受ける。来た合図があるときだけ大きく出す ──
   * ふだんは要らないボタンで画面を埋めたくない。
   */
  const [fromShortcut, setFromShortcut] = useState(false)
  useEffect(() => {
    const u = new URL(window.location.href)
    if (u.searchParams.get('paste') === null && u.hash !== '#paste') return
    setFromShortcut(true)
    // 合図は 1 回きり。読み込み直したときに残っていると、いつまでも出続ける。
    u.searchParams.delete('paste')
    u.hash = ''
    window.history.replaceState(null, '', u.pathname + u.search)
  }, [])

  const removeShot = useCallback(
    async (shot: Shot) => {
      await releaseThumb(shot.id)
      await deleteShot(shot.id)
      setSelected(null)
      await reload()
      setNotice('1 枚を削除しました')
    },
    [reload],
  )

  const saveText = useCallback(
    async (shot: Shot, body: string, speakerRaw: string) => {
      // 手で直した印を付ける。以後の一括読み取りで上書きしないため。
      const next: Shot = { ...shot, body, speakerRaw, textEdited: true, ocr: 'done' }
      await updateShot(next)
      await reload()
      setSelected(next)
      setNotice('直した内容を保存しました')
    },
    [reload],
  )

  const reRecognize = useCallback(
    async (shot: Shot) => {
      // 明示的に押されたときは、手で直した印があっても読み直す。
      await readShots([{ ...shot, textEdited: false }])
      const all = await getAllShots()
      const fresh = all.find((s) => s.id === shot.id)
      if (fresh) setSelected(fresh)
    },
    [readShots],
  )

  /** 1 枚のメタを差し替えて、画面にも即反映する。タグ付けは手数が命なので待たせない。 */
  const patchShot = useCallback(async (shot: Shot, patch: Partial<Shot>) => {
    const next: Shot = { ...shot, ...patch }
    setShots((prev) => prev.map((s) => (s.id === next.id ? next : s)))
    setSelected((cur) => (cur && cur.id === next.id ? next : cur))
    await updateShot(next)
  }, [])

  const toggleIn = (list: string[] | undefined, value: string): string[] => {
    const cur = list ?? []
    return cur.includes(value) ? cur.filter((v) => v !== value) : [...cur, value]
  }

  const toggleMood = useCallback(
    (shot: Shot, mood: string) =>
      void patchShot(shot, { moods: toggleIn(shot.moods, mood), tagged: true }),
    [patchShot],
  )
  const toggleCharacter = useCallback(
    (shot: Shot, id: string) =>
      void patchShot(shot, { characterIds: toggleIn(shot.characterIds, id), tagged: true }),
    [patchShot],
  )
  const toggleFavorite = useCallback(
    (shot: Shot) => void patchShot(shot, { favorite: !shot.favorite }),
    [patchShot],
  )

  const mergeInto = useCallback(
    async (keepId: string, dropId: string) => {
      const merged = mergeCharacters(roster, keepId, dropId)
      if (!merged) return
      await putCharacter(merged.keep)
      await deleteCharacter(dropId)
      // まとめられた側を指していたスクショを、残るほうへ付け替える。
      for (const shot of shots) {
        const patch = repointShot(shot, keepId, dropId)
        if (patch) await updateShot({ ...shot, ...patch })
      }
      await reload()
      setNotice(`「${merged.keep.name}」にまとめました`)
    },
    [roster, shots, reload],
  )

  const renameCharacter = useCallback(
    async (character: Character, name: string) => {
      // その名前の人がすでにいるなら、名前を付け替えるのではなくまとめる。
      // 分かっている名前を種として入れてあるので、誤読を直すと必ずここに来る
      //（「リム」を「広」に直す＝種の「広」に寄せる）。二重に持つと絞り込みが割れる。
      const existing = roster.find(
        (c) => c.id !== character.id && normalizeName(c.name) === normalizeName(name),
      )
      if (existing) {
        await mergeInto(existing.id, character.id)
        return
      }
      // 元の綴りは別名に残す。過去の読み取り結果が当たらなくなるのを防ぐ。
      const aliases = character.aliases.includes(character.name)
        ? character.aliases
        : [...character.aliases, character.name]
      await putCharacter({ ...character, name, aliases, provisional: false })
      await reload()
    },
    [reload, roster, mergeInto],
  )

  const visible = useMemo(() => applyFacets(shots, facets), [shots, facets])
  const unread = useMemo(() => needsOcr(shots), [shots])
  const moods = useMemo(() => allMoods(settings.customMoods), [settings.customMoods])
  const tags = useMemo(() => collectTags(shots), [shots])

  const working = progress !== null || busy !== null || reading !== null

  // --- 選んで送る ---

  /**
   * 選んでいる枚。**いま出ている順**で返す。
   * 押した順ではない ── 送った先に並ぶのは一覧で見えていた順のほうが読める。
   */
  const picked = useMemo(() => visible.filter((s) => pickedIds.has(s.id)), [visible, pickedIds])

  const togglePick = useCallback((shot: Shot) => {
    setPickedIds((prev) => {
      const next = new Set(prev)
      if (next.has(shot.id)) next.delete(shot.id)
      else next.add(shot.id)
      return next
    })
  }, [])

  const leaveSelecting = useCallback(() => {
    setSelecting(false)
    setPickedIds(new Set())
  }, [])

  // 絞り込みを変えると、選んだ枚が画面から消えることがある。
  // 見えていないものを送るのは事故なので、見えているものだけに揃える。
  useEffect(() => {
    if (!selecting) return
    setPickedIds((prev) => {
      const alive = new Set(visible.filter((s) => prev.has(s.id)).map((s) => s.id))
      return alive.size === prev.size ? prev : alive
    })
  }, [selecting, visible])

  const shareSelected = useCallback(async () => {
    if (!picked.length) return
    setBusy(`${picked.length} 枚を用意しています`)
    try {
      const files = await filesFor(picked, roster)
      setBusy(null)
      const outcome = await shareFiles(files)
      if (outcome === 'shared') {
        setNotice(`${files.length} 枚を送りました`)
        leaveSelecting()
      } else if (outcome === 'unsupported') {
        setNotice('この環境では共有シートを開けません。「ZIP で保存」から渡してください')
      }
      // 取り消しは何も言わない。選んだ状態のまま、もう一度押せるようにしておく。
    } finally {
      setBusy(null)
    }
  }, [picked, roster, leaveSelecting])

  const saveSelectedZip = useCallback(async () => {
    if (!picked.length) return
    setBusy(`${picked.length} 枚を ZIP にしています`)
    try {
      saveBlob(await zipFor(picked, roster), zipName())
      setNotice(`${picked.length} 枚を ZIP にしました`)
    } catch (e) {
      setNotice(`ZIP にできませんでした: ${e}`)
    } finally {
      setBusy(null)
    }
  }, [picked, roster])

  /**
   * 詳細から 1 枚だけ送る。
   *
   * 逃げ道は ZIP ではなく、その絵そのものを落とす。1 枚を渡すのに
   * 開いてもらう手間を足す理由がない。
   */
  /**
   * 押してもらわなくても決まるぶんを、仮で付ける。
   *
   * 手で決めたものは触らない。決まった顔が増えるほど、次に推せる顔も増えるので
   * 何度か回す ── ただし回るたびに増えなくなるので、止まったら抜ける。
   */
  const applyAutoAssign = useCallback(async () => {
    for (let round = 0; round < 4; round++) {
      const all = await getAllShots()
      const changed = autoAssign(all)
      if (!changed.size) break
      for (const shot of all) {
        const faces = changed.get(shot.id)
        if (!faces) continue
        // 「写っている人」は足すだけ。ここは名前を付けるだけで外さないので、
        // 枠から組み直すと、枠を持たない手入力（後ろ姿など）が消える。
        const named = new Set(shot.characterIds ?? [])
        for (const f of faces) if (f.characterId) named.add(f.characterId)
        await updateShot({ ...shot, faces, characterIds: [...named] })
      }
    }
  }, [])

  /**
   * 動かした枠の埋め込みを採り直す。
   *
   * 枠が変われば見ている絵が変わるので、並びも取り直さないと意味がずれる。
   * ただしドラッグ中に呼ぶわけにいかない（画像のデコードが要る）ので、
   * 手が止まってからまとめて 1 回。
   */
  const embedTimer = useRef<number>()
  const scheduleEmbed = useCallback((shotId: string) => {
    window.clearTimeout(embedTimer.current)
    embedTimer.current = window.setTimeout(() => {
      void (async () => {
        const shot = (await getAllShots()).find((s) => s.id === shotId)
        if (!shot?.faces?.length) return
        const blob = await getImage(shot.id)
        if (!blob) return
        const px = await toPixels(blob)
        // 全部まとめて採り直す。どれが動いたかを覚えるより、1 回デコードして
        // ぜんぶ計算し直すほうが確かで速い（1 枚あたり数ミリ秒）。
        const faces = shot.faces.map((f) => ({ ...f, embed: embedFace(px, f) }))
        await updateShot({ ...shot, faces })
        await reload()
      })()
    }, 500)
  }, [reload])

  /**
   * 顔の枠を書き換える。
   *
   * 名前を付けた枠は「写っている人」にも足す。枠と characterIds を別々に持つと
   * 必ずずれるので、枠のほうを唯一の出どころにして毎回組み直す。
   * 話者は別扱い ── 喋っていなくても写っていることはあるし、その逆もある。
   */
  const setFaces = useCallback(
    async (shot: Shot, faces: Face[]) => {
      const named = [...new Set(faces.map((f) => f.characterId).filter((v): v is string => !!v))]
      await patchShot(shot, { faces, facesScanned: true, characterIds: named })
      // 手で触ったぶんが見本に加わったので、まだ決まっていない顔を推し直す。
      void applyAutoAssign().then(reload)
      // 埋め込みは落ち着いてから採り直す。ドラッグ中は 1 秒に何度も来るので、
      // そのたびに画像をデコードしていたら指が止まる。
      scheduleEmbed(shot.id)
    },
    [patchShot, scheduleEmbed, applyAutoAssign, reload],
  )

  const shareOne = useCallback(
    async (shot: Shot) => {
      setBusy('用意しています')
      try {
        const files = await filesFor([shot], roster)
        setBusy(null)
        if (!files.length) {
          setNotice('画像を取り出せませんでした')
          return
        }
        const outcome = await shareFiles(files)
        if (outcome === 'shared') setNotice('送りました')
        else if (outcome === 'unsupported') {
          // 保存の名前は共有と別。理由は downloadName を参照。
          const name = downloadName(shot, roster.find((c) => c.id === shot.speakerId))
          saveBlob(files[0], name)
          setNotice(`共有シートが無いので、${name} を保存しました`)
        }
        // 取り消しは何も言わない。詳細は開いたままにしておく。
      } finally {
        setBusy(null)
      }
    },
    [roster],
  )

  const copySelectedText = useCallback(async () => {
    const text = dialogueText(picked, roster)
    if (!text) {
      setNotice('選んだ枚に、まだ読み取ったセリフがありません')
      return
    }
    try {
      await navigator.clipboard.writeText(text)
      setNotice(`${picked.length} 枚ぶんのセリフをコピーしました`)
    } catch {
      setNotice('コピーできませんでした')
    }
  }, [picked, roster])

  return (
    <div className="app">
      <header className="bar">
        <span className="brand">📸 Shot Bank</span>
        <span className="count">{shots.length} 枚</span>
        <button onClick={() => fileInput.current?.click()} disabled={working}>
          取り込む
        </button>
        {roster.length > 0 && (
          <button className="ghost icon" onClick={() => setShowRoster(true)} aria-label="名簿">
            👥
          </button>
        )}
        <button className="ghost icon" onClick={() => setShowSettings(true)} aria-label="設定">
          ⚙
        </button>
      </header>

      <input
        ref={fileInput}
        className="hidden-input"
        type="file"
        accept="image/*"
        multiple
        onChange={(e) => {
          const files = imageFilesFrom(e.target.files)
          e.target.value = ''
          void importFiles(files)
        }}
      />

      <Banners
        settings={settings}
        shotCount={shots.length}
        staleBuild={staleBuild}
        onReload={() => window.location.reload()}
        onOpenSettings={() => setShowSettings(true)}
      />

      {shots.length > 0 && (
        <>
          <SearchBar
            value={facets.query}
            onChange={(query) => setFacets({ ...facets, query })}
            hits={visible.length}
            total={shots.length}
          />
          <FilterBar
            facets={facets}
            onChange={setFacets}
            roster={roster}
            shots={shots}
            moods={moods}
            tags={tags}
          />
        </>
      )}

      {fromShortcut && canReadClipboard() && (
        <div className="paste-call">
          {isIOS() && !isStandalone() && (
            <p className="paste-warn">
              <b>ホーム画面のアプリではなく、ブラウザで開いています。</b>
              iOS ではこの 2 つで保存場所が分かれることがあります。ここで取り込むと
              ホーム画面のアプリに出てこないかもしれません。ショートカットの
              「URL を開く」を「アプリを開く」に変えると、ホーム画面のほうが開きます。
            </p>
          )}
          <p>写真アプリからコピーしてきましたか？</p>
          <button
            onClick={() => {
              setFromShortcut(false)
              void pasteFromClipboard()
            }}
            disabled={working}
          >
            クリップボードから取り込む
          </button>
        </div>
      )}

      {notice && <p className="notice">{notice}</p>}

      {unread.length > 0 && reading === null && (
        <button className="ghost wide" onClick={() => void readShots(unread)}>
          未読み取りの {unread.length} 枚を読み取る
        </button>
      )}

      {visible.length > 0 && !selecting && (
        <div className={canReadClipboard() ? 'bulk three' : 'bulk'}>
          <button className="ghost" onClick={() => setTagging(true)}>
            {visible.length} 枚にタグ
          </button>
          <button className="ghost" onClick={() => setSelecting(true)}>
            選んで送る
          </button>
          {/* ショートカットが「アプリを開く」で来ると URL に合図が付かない。
              いつでも押せる場所に置いておかないと、そこで行き止まりになる。 */}
          {canReadClipboard() && (
            <button className="ghost" onClick={() => void pasteFromClipboard()} disabled={working}>
              貼り付け
            </button>
          )}
        </div>
      )}

      <main>
        {shots.length === 0 ? (
          <div className="empty">
            <p className="empty-title">まだ 1 枚もありません</p>
            <p className="muted">
              スクショを選ぶか、コピーしてから「貼り付け」で取り込めます。
              パソコンならドラッグ＆ドロップと ⌘V も使えます。
            </p>
            <div className="empty-actions">
              <button onClick={() => fileInput.current?.click()} disabled={working}>
                スクショを選ぶ
              </button>
              {canReadClipboard() && (
                <button
                  className="ghost"
                  onClick={() => void pasteFromClipboard()}
                  disabled={working}
                >
                  貼り付け
                </button>
              )}
            </div>
          </div>
        ) : visible.length === 0 ? (
          <p className="muted centered">条件に当たるものはありませんでした。</p>
        ) : (
          <ShotGrid
            shots={visible}
            roster={roster}
            query={facets.query}
            onOpen={setSelected}
            selecting={selecting}
            selectedIds={pickedIds}
            onToggleSelect={togglePick}
          />
        )}
      </main>

      {progress && (
        <div className="progress" role="status">
          <div className="progress-bar">
            <span style={{ width: `${(progress.done / Math.max(1, progress.total)) * 100}%` }} />
          </div>
          <span>
            取り込み中 {progress.done}/{progress.total}
            {progress.currentName && ` — ${progress.currentName}`}
          </span>
        </div>
      )}
      {reading && (
        <div className="progress" role="status">
          <div className="progress-bar">
            <span style={{ width: `${(reading.done / Math.max(1, reading.total)) * 100}%` }} />
          </div>
          <span className="progress-row">
            <span>
              読み取り中 {reading.done}/{reading.total}
              {reading.detail && ` — ${reading.detail}`}
            </span>
            <button className="ghost tiny" onClick={() => (stopReading.current = true)}>
              止める
            </button>
          </span>
        </div>
      )}
      {busy && (
        <div className="progress" role="status">
          <span>{busy}</span>
        </div>
      )}

      {selecting && (
        <SelectionTray
          selected={picked}
          visibleCount={visible.length}
          busy={working}
          onShare={() => void shareSelected()}
          onCopyText={() => void copySelectedText()}
          onSaveZip={() => void saveSelectedZip()}
          onSelectAll={() => setPickedIds(new Set(visible.map((s) => s.id)))}
          onClear={() => setPickedIds(new Set())}
          onExit={leaveSelecting}
        />
      )}

      {dragging && <div className="dropzone">ここに落とすと取り込みます</div>}

      {selected && (
        <DetailSheet
          shot={selected}
          onClose={() => setSelected(null)}
          onDelete={removeShot}
          onSaveText={(shot, body, speaker) => void saveText(shot, body, speaker)}
          onReRecognize={(shot) => void reRecognize(shot)}
          onToggleMood={toggleMood}
          onToggleCharacter={toggleCharacter}
          onSetSpeaker={(shot, id) => void setSpeaker(shot, id)}
          onToggleFavorite={toggleFavorite}
          onShare={(shot) => void shareOne(shot)}
          onFaces={(shot, faces) => void setFaces(shot, faces)}
          allShots={shots}
          roster={roster}
          moods={moods}
          busy={working}
        />
      )}
      {tagging && (
        <TagQueue
          shots={visible}
          roster={roster}
          moods={moods}
          onToggleMood={toggleMood}
          onToggleCharacter={toggleCharacter}
          onToggleFavorite={toggleFavorite}
          onClose={() => setTagging(false)}
        />
      )}
      {duplicates.length > 0 && (
        <DuplicatePanel
          items={duplicates}
          shots={shots}
          onResolve={resolveDuplicate}
          onClose={() => setDuplicates([])}
        />
      )}
      {showRoster && (
        <RosterPanel
          roster={roster}
          shots={shots}
          onRename={(c, name) => void renameCharacter(c, name)}
          onMerge={(keepId, dropId) => void mergeInto(keepId, dropId)}
          onToggleProducer={(c) => {
            void putCharacter({ ...c, isProducer: !c.isProducer }).then(reload)
          }}
          onDelete={(c) => void deleteCharacter(c.id).then(reload)}
          onSeed={() => void seedKnownNames(settings, true)}
          onOpenShot={setSelected}
          onClose={() => setShowRoster(false)}
        />
      )}
      {showSettings && (
        <SettingsPanel
          shots={shots}
          settings={settings}
          onSettings={updateSettings}
          onReload={reload}
          onClose={() => setShowSettings(false)}
          onBusy={setBusy}
          reading={reading !== null}
          onCleared={async () => {
            await seedKnownNames(settings)
          }}
          onReadAll={() => {
            // 手で直したものは触らない。それ以外は読み直す。
            // 読み取りの直しを、すでに取り込んだぶんにも当てるための入口。
            setShowSettings(false)
            void readShots(shots.filter((s) => !s.textEdited))
          }}
        />
      )}
    </div>
  )
}
