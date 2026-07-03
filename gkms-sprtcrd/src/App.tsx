import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { analyzeScreenshot, loadImageData, type AnalyzeProgress } from './lib/analyze'
import { MASTER_TTL_MS, clearAllCaches } from './lib/cache'
import { downloadBlob, downloadText, toCsv, toJson, toTsv, toExportRows } from './lib/exporters'
import {
  buildSignatures,
  exportBaked,
  exportImagesZip,
  fetchLiveMaster,
  importBaked,
  importMasterFromHtml,
  loadInitialMaster,
  toIndexedCards,
  WIKI_PAGE_URL,
  type MasterLoadResult,
  type SignatureFailure,
  type SignatureProgress,
} from './lib/masterSource'
import { levelCap } from './lib/levels'
import { getCustomProxy, setCustomProxy } from './lib/proxy'
import type {
  CardSignature,
  CardType,
  IndexedCard,
  MasterData,
  MatchCandidate,
  ParsedCell,
  Rarity,
} from './lib/types'
import { TYPE_LABELS } from './lib/types'

declare const __BUILD_INFO__: string

type MasterState =
  | { phase: 'empty' }
  | { phase: 'loading'; note: string }
  | { phase: 'ready'; master: MasterData; signatures: Map<string, CardSignature>; note: string }
  | { phase: 'error'; message: string }

export default function App() {
  const [masterState, setMasterState] = useState<MasterState>({ phase: 'empty' })
  const [sigProgress, setSigProgress] = useState<SignatureProgress | null>(null)
  const [sigFailures, setSigFailures] = useState<SignatureFailure[] | null>(null)
  const [analyzing, setAnalyzing] = useState<AnalyzeProgress | null>(null)
  const [cells, setCells] = useState<ParsedCell[]>([])
  const [error, setError] = useState<string>('')
  const [showDiag, setShowDiag] = useState(false)
  const [proxyInput, setProxyInput] = useState(getCustomProxy())
  const fileInputRef = useRef<HTMLInputElement>(null)
  const htmlInputRef = useRef<HTMLInputElement>(null)
  const bakedInputRef = useRef<HTMLInputElement>(null)

  // ---- マスタ管理 -----------------------------------------------------

  const applyLoad = useCallback((r: MasterLoadResult) => {
    setMasterState({ phase: 'ready', master: r.master, signatures: r.signatures, note: r.note })
  }, [])

  useEffect(() => {
    loadInitialMaster()
      .then((r) => {
        if (r) applyLoad(r)
      })
      .catch((e) => setError(String(e)))
  }, [applyLoad])

  const refreshFromWiki = useCallback(async () => {
    setMasterState({ phase: 'loading', note: 'wiki から取得中…' })
    try {
      applyLoad(await fetchLiveMaster())
    } catch (e) {
      setMasterState({ phase: 'error', message: e instanceof Error ? e.message : String(e) })
    }
  }, [applyLoad])

  const buildAllSignatures = useCallback(async () => {
    if (masterState.phase !== 'ready') return
    setSigFailures(null)
    setSigProgress({ done: 0, total: 1, failed: 0, currentCard: '' })
    try {
      const { failed } = await buildSignatures(
        masterState.master,
        masterState.signatures,
        setSigProgress,
      )
      // Map / master.cards[].imageUrl は同一参照のまま更新されるので作り直す
      setMasterState({
        ...masterState,
        master: { ...masterState.master, cards: [...masterState.master.cards] },
        signatures: new Map(masterState.signatures),
      })
      setSigFailures(failed)
    } catch (e) {
      setError(`カード画像の取得に失敗: ${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setSigProgress(null)
    }
  }, [masterState])

  const indexedCards: IndexedCard[] = useMemo(() => {
    if (masterState.phase !== 'ready') return []
    return toIndexedCards(masterState.master, masterState.signatures)
  }, [masterState])

  const cardById = useMemo(() => new Map(indexedCards.map((c) => [c.id, c])), [indexedCards])
  const sigReadyCount = indexedCards.filter((c) => c.signature).length
  const masterStale =
    masterState.phase === 'ready' &&
    masterState.master.source !== 'baked' &&
    Date.now() - masterState.master.fetchedAt > MASTER_TTL_MS

  // ---- スクショ解析 ---------------------------------------------------

  const handleFiles = useCallback(
    async (files: FileList | File[]) => {
      setError('')
      if (indexedCards.length === 0) {
        setError('先にマスタ（wiki のカード一覧）を読み込んでください。')
        return
      }
      if (sigReadyCount === 0) {
        setError('カード画像のシグネチャが未構築です。「②カード画像を取得」を実行してください。')
        return
      }
      try {
        const all: ParsedCell[] = []
        for (const file of Array.from(files)) {
          if (!file.type.startsWith('image/')) continue
          const imageData = await loadImageData(file)
          const { cells: newCells } = await analyzeScreenshot(imageData, indexedCards, setAnalyzing)
          for (const c of newCells) {
            c.index = all.length
            all.push(c)
          }
        }
        setCells((prev) => {
          const merged = [...prev, ...all]
          merged.forEach((c, i) => (c.index = i))
          return merged
        })
      } catch (e) {
        setError(`解析に失敗: ${e instanceof Error ? e.message : String(e)}`)
      } finally {
        setAnalyzing(null)
      }
    },
    [indexedCards, sigReadyCount],
  )

  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const items = e.clipboardData?.files
      if (items && items.length > 0) void handleFiles(items)
    }
    window.addEventListener('paste', onPaste)
    return () => window.removeEventListener('paste', onPaste)
  }, [handleFiles])

  // ---- 行編集 -----------------------------------------------------------

  const updateCell = useCallback((index: number, patch: Partial<ParsedCell>) => {
    setCells((prev) => prev.map((c) => (c.index === index ? { ...c, ...patch } : c)))
  }, [])

  const removeCell = useCallback((index: number) => {
    setCells((prev) => prev.filter((c) => c.index !== index).map((c, i) => ({ ...c, index: i })))
  }, [])

  // ---- エクスポート ------------------------------------------------------

  const exportRows = useMemo(() => toExportRows(cells, cardById), [cells, cardById])
  const stamp = () => new Date().toISOString().slice(0, 10)

  // ---- 描画 --------------------------------------------------------------

  return (
    <div className="app">
      <header>
        <h1>学マス サポカ棚卸し</h1>
        <p className="sub">
          所持サポートカード一覧のスクショから、カード名・Lv・凸数を一覧化します。 名称は
          <a href={WIKI_PAGE_URL} target="_blank" rel="noreferrer">
            学マスwiki（Seesaa）
          </a>
          の表記に従います。
        </p>
      </header>

      <section className="panel advanced-panel">
        <details className="advanced">
          <summary>
            マスタ管理・詳細設定（通常は開かなくて OK）
            {masterState.phase === 'ready'
              ? sigReadyCount < masterState.master.cards.length
                ? ' ⚠ 画像シグネチャ未完'
                : ''
              : ' ⚠ マスタ未読込'}
          </summary>
          <div className="advanced-body">
        {masterState.phase === 'ready' && (
          <p>
            {masterState.master.cards.length} 枚のカードを読み込み済み（{masterState.note}）
            ／画像シグネチャ {sigReadyCount}/{masterState.master.cards.length}
            {masterStale && (
              <span className="warn">
                {' '}
                ⚠ マスタが24時間以上前のものです。新カード実装後は「wikiから再取得」推奨。
              </span>
            )}
          </p>
        )}
        {masterState.phase === 'loading' && <p>{masterState.note}</p>}
        {masterState.phase === 'error' && <p className="error">{masterState.message}</p>}
        {masterState.phase === 'empty' && (
          <p>未取得です。「wikiから取得」を押してください（CORS プロキシ経由）。</p>
        )}
        <div className="row">
          <button onClick={refreshFromWiki} disabled={masterState.phase === 'loading'}>
            wikiから{masterState.phase === 'ready' ? '再' : ''}取得
          </button>
          <button
            onClick={buildAllSignatures}
            disabled={masterState.phase !== 'ready' || sigProgress !== null}
          >
            ②カード画像を取得（照合の準備）
          </button>
          <button onClick={() => setShowDiag((v) => !v)}>
            {showDiag ? '診断を閉じる' : '診断/上級者向け'}
          </button>
        </div>
        {sigProgress && (
          <p>
            カード画像を取得中… {sigProgress.done}/{sigProgress.total}
            {sigProgress.failed > 0 && `（失敗 ${sigProgress.failed}）`}
            <br />
            <span className="hint">
              一覧に画像が無いカードは詳細ページから取得します（初回のみ・低速）。{sigProgress.currentCard}
            </span>
          </p>
        )}
        {sigFailures && sigFailures.length > 0 && (
          <div className="warn">
            ⚠ {sigFailures.length} 件のカード画像を取得できませんでした。プロキシ障害や wiki
            側のブロックが原因のことがあります（時間をおいて再実行するか、カスタムプロキシを設定）。
            <details>
              <summary>失敗したカードと理由</summary>
              <ul>
                {sigFailures.slice(0, 40).map((f, i) => (
                  <li key={i}>
                    {f.card}: {f.reason}
                  </li>
                ))}
                {sigFailures.length > 40 && <li>…他 {sigFailures.length - 40} 件</li>}
              </ul>
            </details>
          </div>
        )}
        {sigFailures && sigFailures.length === 0 && (
          <p className="hint">✅ 全カードの画像取得が完了しました。</p>
        )}

        {showDiag && (
          <div className="diag">
            <h3>診断 / フォールバック</h3>
            <p className="hint">
              wiki 取得は公開 CORS プロキシ経由です。プロキシ障害や wiki
              側のブロックで失敗する場合は、ブラウザで
              <a href={WIKI_PAGE_URL} target="_blank" rel="noreferrer">
                サポートカード一覧ページ
              </a>
              を開いて「別名で保存（HTMLのみ）」したファイルを下からインポートしてください。
            </p>
            <div className="row">
              <button onClick={() => htmlInputRef.current?.click()}>保存HTMLをインポート</button>
              <input
                ref={htmlInputRef}
                type="file"
                accept=".html,.htm,text/html"
                hidden
                onChange={async (e) => {
                  const f = e.target.files?.[0]
                  if (!f) return
                  try {
                    applyLoad(await importMasterFromHtml(await f.text()))
                  } catch (err) {
                    setError(String(err))
                  }
                  e.target.value = ''
                }}
              />
              <button
                disabled={masterState.phase !== 'ready'}
                onClick={() => {
                  if (masterState.phase !== 'ready') return
                  downloadText(
                    'baked-master.json',
                    JSON.stringify(exportBaked(masterState.master, masterState.signatures)),
                    'application/json',
                  )
                }}
              >
                マスタJSONエクスポート
              </button>
              <button
                disabled={masterState.phase !== 'ready'}
                onClick={async () => {
                  if (masterState.phase !== 'ready') return
                  try {
                    const { zip, withImage, sigOnly } = await exportImagesZip(
                      masterState.master,
                      masterState.signatures,
                    )
                    downloadBlob('gkms-sprtcrd-baked.zip', zip)
                    setError('')
                    setSigFailures(null)
                    alert(
                      `画像込みZIPを書き出しました。\n画像あり: ${withImage} 件 / シグネチャのみ: ${sigOnly} 件\n\n中身を gkms-sprtcrd/public/ に展開してコミットすると腹持ちになります（INSTALL.txt 参照）。`,
                    )
                  } catch (err) {
                    setError(`ZIP出力に失敗: ${err instanceof Error ? err.message : String(err)}`)
                  }
                }}
              >
                画像込みZIPをエクスポート（腹持ち用）
              </button>
              <button onClick={() => bakedInputRef.current?.click()}>マスタJSONインポート</button>
              <input
                ref={bakedInputRef}
                type="file"
                accept=".json,application/json"
                hidden
                onChange={async (e) => {
                  const f = e.target.files?.[0]
                  if (!f) return
                  try {
                    applyLoad(await importBaked(await f.text()))
                  } catch (err) {
                    setError(String(err))
                  }
                  e.target.value = ''
                }}
              />
              <button
                onClick={async () => {
                  await clearAllCaches()
                  setMasterState({ phase: 'empty' })
                  setCells([])
                }}
              >
                キャッシュ全消去
              </button>
            </div>
            <div className="row">
              <label>
                カスタムCORSプロキシ（{'{url}'} 置換、例: https://my-proxy.example/?url={'{url}'}）:
                <input
                  type="text"
                  value={proxyInput}
                  size={50}
                  placeholder="空欄なら既定のプロキシを使用"
                  onChange={(e) => setProxyInput(e.target.value)}
                  onBlur={() => setCustomProxy(proxyInput)}
                />
              </label>
            </div>
            {masterState.phase === 'ready' && (
              <details>
                <summary>読み込んだカードの先頭 20 件を確認</summary>
                <ul>
                  {masterState.master.cards.slice(0, 20).map((c) => (
                    <li key={c.id}>
                      [{c.rarity}] {c.name}（{c.typeLabel || TYPE_LABELS[c.type]}）
                      {c.imageUrl ? '' : ' ※画像なし'}
                    </li>
                  ))}
                </ul>
              </details>
            )}
            <p className="hint">build: {__BUILD_INFO__}</p>
          </div>
        )}
          </div>
        </details>
      </section>

      <section className="panel sec-shots">
        <h2>③ スクショを読み込む</h2>
        <div
          className="dropzone"
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault()
            void handleFiles(e.dataTransfer.files)
          }}
          onClick={() => fileInputRef.current?.click()}
        >
          所持サポートカード一覧のスクショをここにドロップ / クリックで選択 /
          Ctrl+V（⌘V）で貼り付け。縦に長い結合スクショ（Picsew 等）も OK。複数枚可。
        </div>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          multiple
          hidden
          onChange={(e) => {
            if (e.target.files) void handleFiles(e.target.files)
            e.target.value = ''
          }}
        />
        {analyzing && (
          <p>
            {analyzing.stage === 'grid' && 'サムネイル位置を検出中…'}
            {analyzing.stage === 'cells' &&
              `サムネイル解析中… ${analyzing.done}/${analyzing.total}`}
            {analyzing.stage === 'ocr' && `Lv 読み取り中… ${analyzing.done}/${analyzing.total}`}
          </p>
        )}
        {error && <p className="error">{error}</p>}
      </section>

      <section className="panel sec-results">
        <h2>
          ④ 結果（{cells.length} 件
          {cells.length > 0 &&
            `、要確認 ${cells.filter((c) => c.warnings.length > 0).length} 件`}
          ）
        </h2>
        {cells.length > 0 && (
          <>
            <div className="row">
              <button onClick={() => navigator.clipboard.writeText(toTsv(exportRows))}>
                クリップボードにコピー (TSV)
              </button>
              <button
                onClick={() => downloadText(`sapoca-${stamp()}.csv`, toCsv(exportRows), 'text/csv')}
              >
                CSV ダウンロード
              </button>
              <button
                onClick={() =>
                  downloadText(`sapoca-${stamp()}.json`, toJson(exportRows), 'application/json')
                }
              >
                JSON ダウンロード
              </button>
              <button onClick={() => setCells([])}>全クリア</button>
            </div>
            <div className="tablewrap">
              <table>
                <thead>
                  <tr>
                    <th>サムネ</th>
                    <th>カード名（マスタから選択で修正可）</th>
                    <th>Lv</th>
                    <th>凸</th>
                    <th>上限解放可能</th>
                    <th>信頼度/警告</th>
                    <th>タイプ</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {cells.map((cell) => (
                    <ResultRow
                      key={cell.index}
                      cell={cell}
                      cards={indexedCards}
                      cardById={cardById}
                      onChange={updateCell}
                      onRemove={removeCell}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
        {cells.length === 0 && <p className="hint">スクショを読み込むとここに一覧が出ます。</p>}
      </section>
    </div>
  )
}

function ResultRow({
  cell,
  cards,
  cardById,
  onChange,
  onRemove,
}: {
  cell: ParsedCell
  cards: IndexedCard[]
  cardById: Map<string, IndexedCard>
  onChange: (index: number, patch: Partial<ParsedCell>) => void
  onRemove: (index: number) => void
}) {
  const card = cell.chosenCardId ? cardById.get(cell.chosenCardId) : undefined
  const confClass =
    cell.confidence === 'high' ? 'conf-high' : cell.confidence === 'medium' ? 'conf-mid' : 'conf-low'
  // タイプはマスタ(wiki)に値があればそれを優先し、無ければスクショ検出値を使う。
  const type: CardType =
    card && card.type !== 'unknown' ? card.type : cell.detectedType
  const ts = TYPE_SHORT[type]
  // レベル上限判定用のレアリティ（採用カードがあればそのレアリティを優先）
  const capRarity: Rarity =
    card && card.rarity !== 'unknown' ? card.rarity : cell.detectedRarity
  // 警告に対応する要素を赤枠にするためのフラグ
  const w = cell.warnings
  const rfMatch = w.some((x) => x.includes('照合') || x.includes('一致するカード'))
  const rfLevel = w.some((x) => x.startsWith('Lv'))
  const rfLB = w.some((x) => x.includes('凸数の自動判定'))
  const rfType = w.some((x) => x.includes('タイプアイコン'))
  const selectCard = (id: string | null) =>
    onChange(cell.index, {
      chosenCardId: id,
      // 手動選択は確定扱いにして照合系の警告から外す
      confidence: id ? 'high' : cell.confidence,
      warnings: id
        ? cell.warnings.filter((w) => !w.includes('照合') && !w.includes('一致するカード'))
        : cell.warnings,
    })
  return (
    <tr className={cell.warnings.length > 0 ? 'has-warn' : ''}>
      <td className="thumb-cell">
        <img src={cell.thumbDataUrl} alt="" className={`thumb${rfMatch ? ' rf' : ''}`} />
      </td>
      <td className="name-cell">
        <CardPicker
          value={cell.chosenCardId}
          cards={cards}
          candidates={cell.candidates}
          cardById={cardById}
          rarity={cell.detectedRarity}
          detectedType={cell.detectedType}
          onSelect={selectCard}
        />
      </td>
      <td className="lv-cell" data-label="Lv">
        <input
          type="number"
          min={1}
          max={capRarity !== 'unknown' ? (levelCap(capRarity, cell.limitBreak) ?? 60) : 60}
          value={cell.level ?? ''}
          placeholder="?"
          className={`lv${rfLevel ? ' rf' : ''}`}
          onChange={(e) =>
            onChange(cell.index, {
              level: e.target.value === '' ? null : Number(e.target.value),
            })
          }
        />
      </td>
      <td className="lb-cell" data-label="凸">
        <select
          className={`lb-select${rfLB ? ' rf' : ''}`}
          value={cell.limitBreak}
          onChange={(e) => onChange(cell.index, { limitBreak: Number(e.target.value) })}
        >
          {[0, 1, 2, 3, 4].map((n) => (
            <option key={n} value={n}>
              {n}凸 {lbStars(n)}
            </option>
          ))}
        </select>
      </td>
      <td className="cap-cell center" data-label="上限解放">
        <input
          type="checkbox"
          checked={cell.canLimitBreak}
          onChange={(e) => onChange(cell.index, { canLimitBreak: e.target.checked })}
        />
      </td>
      <td className="conf-cell" data-label="信頼度">
        <span className={`conf ${confClass}`}>{cell.confidence}</span>
        {cell.warnings.length > 0 && (
          <WarningList
            warnings={cell.warnings}
            onSolve={(i) =>
              onChange(cell.index, { warnings: cell.warnings.filter((_, j) => j !== i) })
            }
          />
        )}
      </td>
      <td className="type-cell" data-label="タイプ">
        <span
          className={`typebadge${rfType ? ' rf' : ''}`}
          style={{ color: ts.color, borderColor: ts.color }}
        >
          {ts.label}
        </span>
      </td>
      <td className="act-cell">
        <button className="ghost" title="この行を削除" onClick={() => onRemove(cell.index)}>
          ✕
        </button>
      </td>
    </tr>
  )
}

/** 凸数を「★（済）☆（未）」の4個並びで表す（例: 2凸 → ★★☆☆）。 */
function lbStars(n: number): string {
  const filled = Math.max(0, Math.min(4, n))
  return '★'.repeat(filled) + '☆'.repeat(4 - filled)
}

/** タイプの短縮ラベル・表示色・淡い背景色（Vo=赤, Da=青, Vi=アンバー, As=緑）。 */
const TYPE_SHORT: Record<CardType, { label: string; color: string; tint: string }> = {
  vocal: { label: 'Vo', color: '#e0245e', tint: '#fdeaf1' },
  dance: { label: 'Da', color: '#2f6fed', tint: '#e9f0fe' },
  visual: { label: 'Vi', color: '#c98a00', tint: '#fbf2dd' },
  assist: { label: 'As', color: '#1e9e5a', tint: '#e7f6ec' },
  unknown: { label: '—', color: '#bbb', tint: 'transparent' },
}

/** 警告を1件ずつ表示し、タップ→「解決する」でその警告だけ消せるリスト。 */
function WarningList({ warnings, onSolve }: { warnings: string[]; onSolve: (i: number) => void }) {
  const [openIdx, setOpenIdx] = useState<number | null>(null)
  return (
    <span className="warnlist">
      {warnings.map((w, i) => (
        <span key={i} className="warnchip-wrap">
          <button
            type="button"
            className="warnchip"
            onClick={() => setOpenIdx(openIdx === i ? null : i)}
          >
            ⚠ {w}
          </button>
          {openIdx === i && (
            <span className="warn-pop">
              <button
                type="button"
                className="warn-solve"
                onClick={() => {
                  onSolve(i)
                  setOpenIdx(null)
                }}
              >
                解決する
              </button>
            </span>
          )}
        </span>
      ))}
    </span>
  )
}

/** プルダウンのグループ見出し（推定レアリティ×推定タイプの4段階）。 */
function groupLabel(bi: number, rarity: Rarity, type: CardType): string {
  const t = TYPE_SHORT[type].label
  if (bi === 3) return `レアリティ・タイプ一致（${rarity}・${t}）`
  if (bi === 2) return `レアリティ一致（${rarity}）`
  if (bi === 1) return `推定タイプ一致（${t}）`
  return 'その他'
}

/**
 * 画像付きのカード選択コンボボックス。
 * <select> は画像を出せないため自作。候補（距離順）→全カードの並びで、
 * 各項目にサムネイルを表示し、テキストで絞り込みできる。
 */
function CardPicker({
  value,
  cards,
  candidates,
  cardById,
  rarity,
  detectedType,
  onSelect,
}: {
  value: string | null
  cards: IndexedCard[]
  candidates: MatchCandidate[]
  cardById: Map<string, IndexedCard>
  rarity: Rarity
  detectedType: CardType
  onSelect: (id: string | null) => void
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const rootRef = useRef<HTMLDivElement>(null)
  const selected = value ? cardById.get(value) : undefined
  const useRarity = rarity !== 'unknown'
  const useType = detectedType !== 'unknown'
  // 推定レアリティ×推定タイプで4段階に分類（優先度の高い順）:
  //   3: レアリティ一致&タイプ一致 / 2: レアリティ一致 / 1: タイプ一致 / 0: その他
  const buckets = useMemo(() => {
    const b: IndexedCard[][] = [[], [], [], []]
    for (const c of cards) {
      const r = useRarity && c.rarity === rarity ? 2 : 0
      const t = useType && c.type === detectedType ? 1 : 0
      b[r + t].push(c)
    }
    return b
  }, [cards, rarity, detectedType, useRarity, useType])

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  const q = query.trim().toLowerCase()
  const filtered = q ? cards.filter((c) => c.name.toLowerCase().includes(q)) : null

  const choose = (id: string | null) => {
    onSelect(id)
    setOpen(false)
    setQuery('')
  }

  return (
    <div className="cardpicker" ref={rootRef}>
      <button type="button" className="cardpicker-btn" onClick={() => setOpen((v) => !v)}>
        {selected ? (
          <>
            <span className="cp-thumb-wrap">
              {selected.imageUrl ? (
                <img src={selected.imageUrl} alt="" className="cp-thumb" loading="lazy" />
              ) : (
                <span className="cp-thumb cp-noimg" />
              )}
              <span
                className="cp-type-corner"
                style={{ background: TYPE_SHORT[selected.type].color }}
              >
                {TYPE_SHORT[selected.type].label}
              </span>
            </span>
            <span className="cp-name">
              [{selected.rarity}] {selected.name}
            </span>
          </>
        ) : (
          <span className="cp-placeholder">（未特定）— クリックで選択</span>
        )}
        <span className="cp-caret">▾</span>
      </button>
      {open && (
        <div className="cardpicker-pop">
          <input
            className="cp-search"
            placeholder="カード名で絞り込み…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <div className="cp-list">
            <button type="button" className="cp-opt cp-clear" onClick={() => choose(null)}>
              （未特定）
            </button>
            {filtered === null ? (
              <>
                {candidates.length > 0 && <div className="cp-group">候補（距離順）</div>}
                {candidates.map((cand) => {
                  const c = cardById.get(cand.cardId)
                  if (!c) return null
                  return (
                    <CardOption
                      key={`cand-${c.id}`}
                      card={c}
                      extra={`d=${cand.distance.toFixed(3)}`}
                      onClick={() => choose(c.id)}
                    />
                  )
                })}
                {useRarity || useType ? (
                  [3, 2, 1, 0].map((bi) =>
                    buckets[bi].length === 0 ? null : (
                      <Fragment key={bi}>
                        <div className="cp-group">{groupLabel(bi, rarity, detectedType)}</div>
                        {buckets[bi].map((c) => (
                          <CardOption key={c.id} card={c} onClick={() => choose(c.id)} />
                        ))}
                      </Fragment>
                    ),
                  )
                ) : (
                  <>
                    <div className="cp-group">全カード</div>
                    {cards.map((c) => (
                      <CardOption key={c.id} card={c} onClick={() => choose(c.id)} />
                    ))}
                  </>
                )}
              </>
            ) : filtered.length === 0 ? (
              <div className="cp-empty">該当なし</div>
            ) : (
              filtered.map((c) => <CardOption key={c.id} card={c} onClick={() => choose(c.id)} />)
            )}
          </div>
        </div>
      )}
    </div>
  )
}

function CardOption({
  card,
  extra,
  onClick,
}: {
  card: IndexedCard
  extra?: string
  onClick: () => void
}) {
  return (
    <button type="button" className={`cp-opt type-${card.type}`} onClick={onClick}>
      {card.imageUrl ? (
        <img src={card.imageUrl} alt="" className="cp-thumb" loading="lazy" />
      ) : (
        <span className="cp-thumb cp-noimg" />
      )}
      <span className="cp-opt-main">
        <span className="cp-type-opt" style={{ background: TYPE_SHORT[card.type].color }}>
          {TYPE_SHORT[card.type].label}
        </span>
        <span className="cp-name">
          [{card.rarity}] {card.name}
        </span>
      </span>
      {extra && <span className="cp-extra">{extra}</span>}
    </button>
  )
}
