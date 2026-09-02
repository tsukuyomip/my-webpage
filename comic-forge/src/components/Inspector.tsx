import {
  addBalloon,
  addTail,
  newBalloon,
  removeBalloon,
  removeTail,
  reorderBalloon,
  SHAPES,
  updateBalloon,
  updateTail,
} from '../lib/balloon-edit'
import { coverScale } from '../lib/render'
import { layout, normalizeRatios } from '../lib/layout'
import type { Selection } from '../lib/overlay'
import { nodeAt, removePanel, setSplitGutter, setTilt, splitPanel, setBoundary } from '../lib/tree'
import type { Panel, PanelId, Project } from '../lib/types'
import Field from './Field'
import NudgePad from './NudgePad'
import type { Mode } from './CanvasView'
import TextInspector from './TextInspector'

interface Props {
  doc: Project
  mode: Mode
  selection: Selection
  onSelect: (s: Selection) => void
  commit: (next: Project) => void
  live: (next: Project) => void
  beginGesture: () => void
  endGesture: () => void
  swapFrom: PanelId | null
  setSwapFrom: (id: PanelId | null) => void
  onPickImage: (id: PanelId) => void
}

export default function Inspector(props: Props) {
  const { mode, selection } = props
  if (mode === 'panel') {
    if (selection?.kind === 'boundary') return <BoundaryInspector {...props} selection={selection} />
    if (selection?.kind === 'panel') return <PanelInspector {...props} id={selection.id} />
    return <PageInspector {...props} />
  }
  if (mode === 'image') {
    if (selection?.kind === 'panel') return <ImageInspector {...props} id={selection.id} />
    return <p className="empty">コマをタップして選ぶと、画像を入れられます。</p>
  }
  if (mode === 'balloon') return <BalloonInspector {...props} />
  return (
    <TextInspector
      doc={props.doc}
      selection={selection}
      commit={props.commit}
      live={props.live}
      endGesture={props.endGesture}
    />
  )
}

/* ── コマ ──────────────────────────────── */

function PanelInspector(props: Props & { id: PanelId }) {
  const { doc, id, commit } = props
  const panel = doc.panels[id]
  if (!panel) return <p className="empty">このコマは見つかりませんでした。</p>
  const only = Object.keys(doc.panels).length <= 1
  const set = (next: Partial<Panel>) =>
    ({ ...doc, panels: { ...doc.panels, [id]: { ...panel, ...next } } })
  const insetAll = Math.round(
    (panel.inset.top + panel.inset.right + panel.inset.bottom + panel.inset.left) / 4,
  )

  return (
    <>
      <div className="group">
        <div className="label">割る</div>
        <div className="row">
          <button className="btn grow" onClick={() => commit(splitPanel(doc, id, 'row'))}>
            ─ 横に割る
          </button>
          <button className="btn grow" onClick={() => commit(splitPanel(doc, id, 'col'))}>
            │ 縦に割る
          </button>
        </div>
        <div className="row">
          <button
            className={`btn grow ${props.swapFrom === id ? 'on' : ''}`}
            onClick={() => props.setSwapFrom(props.swapFrom === id ? null : id)}
          >
            {props.swapFrom === id ? '入れ替え先をタップ' : '⇄ 入れ替え'}
          </button>
          <button
            className="btn danger"
            disabled={only}
            onClick={() => {
              props.onSelect(null)
              commit(removePanel(doc, id))
            }}
          >
            削除
          </button>
        </div>
      </div>

      <div className="group">
        <div className="label">このコマだけの余白（割り当てられた枠から内側へ）</div>
        <Field
          label="四辺いっしょに"
          value={insetAll}
          min={0}
          max={160}
          onChange={(v) => props.live(set({ inset: { top: v, right: v, bottom: v, left: v } }))}
          onCommit={props.endGesture}
        />
        <div className="row wrap">
          {(['top', 'right', 'bottom', 'left'] as const).map((side) => (
            <div key={side} style={{ flex: '1 1 45%' }}>
              <Field
                label={{ top: '上', right: '右', bottom: '下', left: '左' }[side]}
                value={panel.inset[side]}
                min={0}
                max={200}
                onChange={(v) => props.live(set({ inset: { ...panel.inset, [side]: v } }))}
                onCommit={props.endGesture}
              />
            </div>
          ))}
        </div>
        <Field
          label="コマの角度"
          value={panel.rotate}
          min={-20}
          max={20}
          step={0.5}
          digits={1}
          suffix="°"
          onChange={(v) => props.live(set({ rotate: v }))}
          onCommit={props.endGesture}
        />
      </div>

      <div className="group">
        <div className="label">枠線</div>
        <div className="row">
          <button
            className={`btn grow ${panel.frame === null ? 'on' : ''}`}
            onClick={() => commit(set({ frame: panel.frame === null ? undefined : null }))}
          >
            {panel.frame === null ? '枠なし' : '枠を消す'}
          </button>
          <button
            className="btn"
            disabled={panel.frame === undefined}
            onClick={() => commit(set({ frame: undefined }))}
          >
            既定に戻す
          </button>
        </div>
        {panel.frame !== null && (
          <>
            <Field
              label="太さ"
              value={panel.frame?.width ?? doc.page.frame.width}
              min={0}
              max={24}
              step={0.5}
              digits={1}
              onChange={(v) => props.live(set({ frame: { ...(panel.frame ?? {}), width: v } }))}
              onCommit={props.endGesture}
            />
            <Field
              label="角の丸み"
              value={panel.frame?.radius ?? doc.page.frame.radius}
              min={0}
              max={80}
              onChange={(v) => props.live(set({ frame: { ...(panel.frame ?? {}), radius: v } }))}
              onCommit={props.endGesture}
            />
          </>
        )}
      </div>
    </>
  )
}

/* ── 割の境界 ──────────────────────────── */

function BoundaryInspector(props: Props & { selection: { kind: 'boundary'; path: number[]; index: number } }) {
  const { doc, selection } = props
  const node = nodeAt(doc.layout, selection.path)
  if (!node || node.kind !== 'split') return <p className="empty">この割は無くなりました。</p>
  const ratios = normalizeRatios(node.ratios)
  const t = ratios.slice(0, selection.index + 1).reduce((s, r) => s + r, 0)
  const tilt = node.tilt[selection.index] ?? 0

  return (
    <>
      <div className="group">
        <div className="label">
          {node.dir === 'row' ? '横の割（上下を分ける線）' : '縦の割（左右を分ける線）'}
        </div>
        <Field
          label="位置"
          value={t * 100}
          min={2}
          max={98}
          step={0.5}
          digits={1}
          suffix="%"
          onChange={(v) => props.live(setBoundary(doc, selection.path, selection.index, v / 100))}
          onCommit={props.endGesture}
        />
        <Field
          label="傾き"
          value={tilt * 100}
          min={-40}
          max={40}
          step={0.5}
          digits={1}
          suffix="%"
          onChange={(v) => props.live(setTilt(doc, selection.path, selection.index, v / 100))}
          onCommit={props.endGesture}
        />
        {tilt !== 0 && (
          <div className="row">
            <button
              className="btn grow"
              onClick={() => props.commit(setTilt(doc, selection.path, selection.index, 0))}
            >
              まっすぐに戻す
            </button>
          </div>
        )}
      </div>
      <div className="group">
        <div className="label">この割だけの溝</div>
        <Field
          label="溝の幅"
          value={node.gutter ?? doc.page.gutter}
          min={0}
          max={120}
          onChange={(v) => props.live(setSplitGutter(doc, selection.path, v))}
          onCommit={props.endGesture}
        />
        {node.gutter !== undefined && (
          <div className="row">
            <button
              className="btn grow"
              onClick={() => props.commit(setSplitGutter(doc, selection.path, undefined))}
            >
              ページの既定に戻す
            </button>
          </div>
        )}
      </div>
      <p className="note">傾きを入れると、そこから下（内側）の割も一緒に傾きます。</p>
    </>
  )
}

/* ── ページ全体 ─────────────────────────── */

function PageInspector(props: Props) {
  const { doc } = props
  const page = doc.page
  const setPage = (next: Partial<typeof page>) => ({ ...doc, page: { ...page, ...next } })
  const margin = Math.round(
    (page.margin.top + page.margin.right + page.margin.bottom + page.margin.left) / 4,
  )
  return (
    <>
      <p className="note" style={{ marginTop: 0 }}>
        コマをタップすると、そのコマの設定になります。
      </p>
      <div className="group">
        <div className="label">ページ全体</div>
        <Field
          label="紙の余白"
          value={margin}
          min={0}
          max={160}
          onChange={(v) =>
            props.live(setPage({ margin: { top: v, right: v, bottom: v, left: v } }))
          }
          onCommit={props.endGesture}
        />
        <Field
          label="コマの溝"
          value={page.gutter}
          min={0}
          max={140}
          onChange={(v) => props.live(setPage({ gutter: v }))}
          onCommit={props.endGesture}
        />
      </div>
      <div className="group">
        <div className="label">枠線の既定</div>
        <Field
          label="太さ"
          value={page.frame.width}
          min={0}
          max={24}
          step={0.5}
          digits={1}
          onChange={(v) => props.live(setPage({ frame: { ...page.frame, width: v } }))}
          onCommit={props.endGesture}
        />
        <Field
          label="角の丸み"
          value={page.frame.radius}
          min={0}
          max={80}
          onChange={(v) => props.live(setPage({ frame: { ...page.frame, radius: v } }))}
          onCommit={props.endGesture}
        />
        <div className="row">
          <label className="row" style={{ gap: 8, margin: 0 }}>
            <span style={{ fontSize: 13, color: 'var(--muted)' }}>枠の色</span>
            <input
              type="color"
              value={page.frame.color}
              onChange={(e) => props.commit(setPage({ frame: { ...page.frame, color: e.target.value } }))}
            />
          </label>
          <label className="row" style={{ gap: 8, margin: 0 }}>
            <span style={{ fontSize: 13, color: 'var(--muted)' }}>紙の色</span>
            <input
              type="color"
              value={page.background}
              onChange={(e) => props.commit(setPage({ background: e.target.value }))}
            />
          </label>
        </div>
      </div>
    </>
  )
}

/* ── 画像 ──────────────────────────────── */

function ImageInspector(props: Props & { id: PanelId }) {
  const { doc, id } = props
  const panel = doc.panels[id]
  const content = panel?.content
  const box = layout(doc).panels.find((p) => p.id === id)

  if (!panel) return <p className="empty">このコマは見つかりませんでした。</p>
  if (!content) {
    return (
      <div className="group">
        <div className="label">このコマは空です</div>
        <button className="btn primary grow" onClick={() => props.onPickImage(id)}>
          画像を入れる
        </button>
      </div>
    )
  }

  const meta = doc.assets[content.asset]
  const set = (next: Partial<typeof content>) =>
    ({ ...doc, panels: { ...doc.panels, [id]: { ...panel, content: { ...content, ...next } } } })

  const refit = () => {
    if (!box || !meta) return
    props.commit(
      set({ x: 0, y: 0, rotate: 0, scale: coverScale(box.quad, meta.width, meta.height) }),
    )
  }

  return (
    <>
      <div className="group">
        <div className="label">
          {meta ? `${meta.name}（${meta.width}×${meta.height}）` : '画像'}
        </div>
        <div className="row">
          <button className="btn grow" onClick={() => props.onPickImage(id)}>
            差し替え
          </button>
          <button className="btn" onClick={refit}>
            はめ直す
          </button>
          <button
            className="btn danger"
            onClick={() => {
              const { content: _drop, ...rest } = panel
              props.commit({ ...doc, panels: { ...doc.panels, [id]: rest } })
            }}
          >
            外す
          </button>
        </div>
      </div>

      <div className="group">
        <div className="label">位置</div>
        <NudgePad onNudge={(dx, dy) => props.commit(set({ x: content.x + dx, y: content.y + dy }))} />
      </div>

      <div className="group">
        <div className="label">大きさと向き</div>
        <Field
          label="拡大"
          value={content.scale * 100}
          min={5}
          max={600}
          step={1}
          suffix="%"
          onChange={(v) => props.live(set({ scale: v / 100 }))}
          onCommit={props.endGesture}
        />
        <Field
          label="角度"
          value={content.rotate}
          min={-180}
          max={180}
          step={0.5}
          digits={1}
          suffix="°"
          onChange={(v) => props.live(set({ rotate: v }))}
          onCommit={props.endGesture}
        />
        <div className="row">
          <button
            className={`btn grow ${content.flipX ? 'on' : ''}`}
            onClick={() => props.commit(set({ flipX: !content.flipX }))}
          >
            ⇋ 左右反転
          </button>
          <button className="btn grow" onClick={() => props.commit(set({ rotate: 0 }))}>
            角度を戻す
          </button>
        </div>
      </div>
    </>
  )
}

/* ── 吹き出し ───────────────────────────── */

function BalloonInspector(props: Props) {
  const { doc, selection } = props
  const selected = selection?.kind === 'balloon' ? doc.balloons.find((b) => b.id === selection.id) : null
  const panelId = selection?.kind === 'panel' ? selection.id : undefined

  if (!selected) {
    return (
      <>
        <div className="group">
          <div className="label">
            {panelId ? 'このコマに吹き出しを置く' : 'コマをタップして選ぶと、そのコマに置けます'}
          </div>
          <button
            className="btn primary grow"
            style={{ width: '100%' }}
            onClick={() => {
              const b = newBalloon(doc, layout(doc), panelId)
              props.commit(addBalloon(doc, b))
              props.onSelect({ kind: 'balloon', id: b.id })
            }}
          >
            吹き出しを足す
          </button>
        </div>
        {doc.balloons.length > 0 && (
          <div className="group">
            <div className="label">置いてある吹き出し（{doc.balloons.length}）</div>
            <p className="note" style={{ marginTop: 0 }}>
              吹き出しをタップすると選べます。奥にあるものは「前へ」で手前に出せます。
            </p>
          </div>
        )}
      </>
    )
  }

  const b = selected
  const set = (patch: Parameters<typeof updateBalloon>[2]) => updateBalloon(doc, b.id, patch)

  return (
    <>
      <div className="group">
        <div className="label">形</div>
        <div className="chips">
          {SHAPES.map((s) => (
            <button key={s.id} aria-pressed={b.shape === s.id} onClick={() => props.commit(set({ shape: s.id }))}>
              {s.label}
            </button>
          ))}
        </div>
        {(b.shape === 'cloud' || b.shape === 'burst') && (
          <>
            <Field
              label="数"
              value={b.shapeParams.count ?? (b.shape === 'cloud' ? 9 : 14)}
              min={3}
              max={30}
              onChange={(v) => props.live(set({ shapeParams: { ...b.shapeParams, count: v } }))}
              onCommit={props.endGesture}
            />
            <Field
              label="ふくらみ"
              value={(b.shapeParams.amplitude ?? (b.shape === 'cloud' ? 0.14 : 0.18)) * 100}
              min={2}
              max={45}
              suffix="%"
              onChange={(v) => props.live(set({ shapeParams: { ...b.shapeParams, amplitude: v / 100 } }))}
              onCommit={props.endGesture}
            />
          </>
        )}
        {b.shape === 'round' && (
          <Field
            label="角の丸み"
            value={b.shapeParams.radius ?? Math.min(b.w, b.h) * 0.275}
            min={0}
            max={Math.min(b.w, b.h) / 2}
            onChange={(v) => props.live(set({ shapeParams: { ...b.shapeParams, radius: v } }))}
            onCommit={props.endGesture}
          />
        )}
      </div>

      <div className="group">
        <div className="label">大きさと向き</div>
        <Field
          label="幅"
          value={b.w}
          min={30}
          max={doc.page.width}
          onChange={(v) => props.live(set({ w: v }))}
          onCommit={props.endGesture}
        />
        <Field
          label="高さ"
          value={b.h}
          min={24}
          max={doc.page.height}
          onChange={(v) => props.live(set({ h: v }))}
          onCommit={props.endGesture}
        />
        <Field
          label="角度"
          value={b.rotate}
          min={-45}
          max={45}
          step={0.5}
          digits={1}
          suffix="°"
          onChange={(v) => props.live(set({ rotate: v }))}
          onCommit={props.endGesture}
        />
        <NudgePad onNudge={(dx, dy) => props.commit(set({ x: b.x + dx, y: b.y + dy }))} />
      </div>

      <div className="group">
        <div className="label">しっぽ（{b.tails.length}）</div>
        {b.tails.map((t, i) => (
          <div key={i} style={{ marginBottom: 10 }}>
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <span style={{ fontSize: 12, color: 'var(--muted)' }}>{i + 1} 本目</span>
              <button className="btn danger" onClick={() => props.commit(removeTail(doc, b.id, i))}>
                消す
              </button>
            </div>
            <Field
              label="向き"
              value={t.at * 360}
              min={0}
              max={359}
              suffix="°"
              onChange={(v) => props.live(updateTail(doc, b.id, i, { at: v / 360 }))}
              onCommit={props.endGesture}
            />
            <Field
              label="長さ"
              value={t.len}
              min={0}
              max={Math.max(300, b.h * 3)}
              onChange={(v) => props.live(updateTail(doc, b.id, i, { len: v }))}
              onCommit={props.endGesture}
            />
            <Field
              label="根元の幅"
              value={t.spread * 100}
              min={1}
              max={35}
              suffix="%"
              onChange={(v) => props.live(updateTail(doc, b.id, i, { spread: v / 100 }))}
              onCommit={props.endGesture}
            />
            <Field
              label="曲がり"
              value={t.bend * 100}
              min={-80}
              max={80}
              suffix="%"
              onChange={(v) => props.live(updateTail(doc, b.id, i, { bend: v / 100 }))}
              onCommit={props.endGesture}
            />
          </div>
        ))}
        <button className="btn grow" style={{ width: '100%' }} onClick={() => props.commit(addTail(doc, b.id))}>
          しっぽを足す
        </button>
      </div>

      <div className="group">
        <div className="label">色と線</div>
        <Field
          label="線の太さ"
          value={b.strokeWidth}
          min={0}
          max={20}
          step={0.5}
          digits={1}
          onChange={(v) => props.live(set({ strokeWidth: v }))}
          onCommit={props.endGesture}
        />
        <div className="row">
          <label className="row" style={{ gap: 8, margin: 0 }}>
            <span style={{ fontSize: 13, color: 'var(--muted)' }}>塗り</span>
            <input type="color" value={b.fill} onChange={(e) => props.commit(set({ fill: e.target.value }))} />
          </label>
          <label className="row" style={{ gap: 8, margin: 0 }}>
            <span style={{ fontSize: 13, color: 'var(--muted)' }}>線</span>
            <input type="color" value={b.stroke} onChange={(e) => props.commit(set({ stroke: e.target.value }))} />
          </label>
        </div>
      </div>

      <div className="group">
        <div className="label">置き方</div>
        <div className="row">
          <button className="btn grow" onClick={() => props.commit(reorderBalloon(doc, b.id, -1))}>
            ↓ 奥へ
          </button>
          <button className="btn grow" onClick={() => props.commit(reorderBalloon(doc, b.id, 1))}>
            ↑ 手前へ
          </button>
        </div>
        {b.anchor && (
          <div className="row">
            <button
              className={`btn grow ${b.clip ? 'on' : ''}`}
              onClick={() => props.commit(set({ clip: !b.clip }))}
            >
              {b.clip ? 'コマからはみ出さない' : 'コマをはみ出してよい'}
            </button>
          </div>
        )}
        <div className="row">
          <button
            className="btn danger grow"
            onClick={() => {
              props.onSelect(null)
              props.commit(removeBalloon(doc, b.id))
            }}
          >
            この吹き出しを消す
          </button>
        </div>
      </div>
      <p className="note">
        {b.anchor
          ? 'このコマに付いているので、割を動かすと一緒に動きます。'
          : 'ページに直接置いてあります。'}
      </p>
    </>
  )
}
