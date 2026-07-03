import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { analyzeScreenshot, loadImageData, type AnalyzeProgress } from './lib/analyze'
import { MASTER_TTL_MS, clearAllCaches } from './lib/cache'
import { downloadText, toCsv, toJson, toTsv, toExportRows } from './lib/exporters'
import {
  buildSignatures,
  exportBaked,
  fetchLiveMaster,
  importBaked,
  importMasterFromHtml,
  loadInitialMaster,
  toIndexedCards,
  WIKI_PAGE_URL,
  type MasterLoadResult,
  type SignatureProgress,
} from './lib/masterSource'
import { getCustomProxy, setCustomProxy } from './lib/proxy'
import type { CardSignature, IndexedCard, MasterData, ParsedCell } from './lib/types'
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
    setSigProgress({ done: 0, total: 1, failed: 0, currentUrl: '' })
    try {
      await buildSignatures(masterState.master, masterState.signatures, setSigProgress)
      // Map は同一参照のまま増えるので state を作り直して再レンダリング
      setMasterState({ ...masterState, signatures: new Map(masterState.signatures) })
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

      <section className="panel">
        <h2>① マスタ（wiki カード一覧）</h2>
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
            画像シグネチャ構築中… {sigProgress.done}/{sigProgress.total}
            {sigProgress.failed > 0 && `（失敗 ${sigProgress.failed}）`}
          </p>
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
      </section>

      <section className="panel">
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

      <section className="panel">
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
  return (
    <tr className={cell.warnings.length > 0 ? 'has-warn' : ''}>
      <td>
        <img src={cell.thumbDataUrl} alt="" className="thumb" />
      </td>
      <td>
        <select
          value={cell.chosenCardId ?? ''}
          onChange={(e) => {
            const id = e.target.value || null
            onChange(cell.index, {
              chosenCardId: id,
              // 手動選択は確定扱いにして警告から外す
              confidence: id ? 'high' : cell.confidence,
              warnings: id
                ? cell.warnings.filter(
                    (w) => !w.includes('照合') && !w.includes('一致するカード'),
                  )
                : cell.warnings,
            })
          }}
        >
          <option value="">（未特定）</option>
          {/* 照合候補を先頭に出し、続けて全カード */}
          <optgroup label="候補（距離順）">
            {cell.candidates.map((cand) => {
              const c = cardById.get(cand.cardId)
              return (
                <option key={`cand-${cand.cardId}`} value={cand.cardId}>
                  {c ? `[${c.rarity}] ${c.name}` : cand.cardId}（d={cand.distance.toFixed(3)}）
                </option>
              )
            })}
          </optgroup>
          <optgroup label="全カード">
            {cards.map((c) => (
              <option key={c.id} value={c.id}>
                [{c.rarity}] {c.name}
              </option>
            ))}
          </optgroup>
        </select>
        {card && (
          <span className="cardmeta">
            [{card.rarity}] {card.typeLabel || TYPE_LABELS[card.type]}
          </span>
        )}
      </td>
      <td>
        <input
          type="number"
          min={1}
          max={60}
          value={cell.level ?? ''}
          placeholder="?"
          className="lv"
          onChange={(e) =>
            onChange(cell.index, {
              level: e.target.value === '' ? null : Number(e.target.value),
            })
          }
        />
      </td>
      <td>
        <select
          value={cell.limitBreak}
          onChange={(e) => onChange(cell.index, { limitBreak: Number(e.target.value) })}
        >
          {[0, 1, 2, 3, 4].map((n) => (
            <option key={n} value={n}>
              {n}凸
            </option>
          ))}
        </select>
      </td>
      <td className="center">
        <input
          type="checkbox"
          checked={cell.canLimitBreak}
          onChange={(e) => onChange(cell.index, { canLimitBreak: e.target.checked })}
        />
      </td>
      <td>
        <span className={`conf ${confClass}`}>{cell.confidence}</span>
        {cell.warnings.length > 0 && <span className="warn"> ⚠ {cell.warnings.join('、')}</span>}
      </td>
      <td>
        <button className="ghost" title="この行を削除" onClick={() => onRemove(cell.index)}>
          ✕
        </button>
      </td>
    </tr>
  )
}
