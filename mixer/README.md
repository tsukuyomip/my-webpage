# 🎛️ Mixer

複数の音源・動画をタイムライン上で整列し、リアルタイムに mute / solo / SE を切り替えながらプレビューできる Web アプリ。
開発プランは [`../docs/mixer-plan.md`](../docs/mixer-plan.md) を参照。

## 技術スタック

React + Vite + TypeScript / Web Audio API。GitHub Pages のサブパス `/mixer/` で配信する想定（`vite.config.ts` の `base` を参照）。

## 開発

```bash
npm install
npm run dev      # ローカルプレビュー
npm run build    # 型チェック + 静的ビルド (dist/)
npm run preview  # ビルド成果物のプレビュー
```

## 進捗

- **Phase 0** — Vite + React + TS の足場、`/mixer/` base パス設定。✅
- **Phase 1** — オーディオエンジン + トランスポート（複数ファイル読込・Web Audio グラフ・master clock・play / pause / seek・mute / solo・シークバー / プレイヘッド）。✅
- **Phase 2** — タイムライン整列（クリップをドラッグして開始オフセット調整・クリップブロック表示）。✅
- **Phase 3** — オートメーション。mute / solo の時刻付きトグルマーカー（一時停止中編集・再生中リアルタイム適用）と、SE ワンショット（読込・今すぐ発声・タイムラインキュー発火）。✅
- **Phase 4** — 動画グリッドプレビュー。video トラック対応（同じ master clock で同期）、グリッド / 横並び / 縦並びレイアウト、mute / solo 時のグレーアウト（透過度は設定可能）。✅
- **Phase 5** — プロジェクト保存 / 再開。タイムライン状態＋メディアを IndexedDB に保存し、名前付きで再開。✅
- **Phase 6** — 動画 / ミックス書き出し。video をキャンバス合成、master 音声を MediaStream で取得し MediaRecorder で WebM 録画（実時間）。✅

計画（`docs/mixer-plan.md`）の全フェーズを実装済み。

## アーキテクチャ概要

- `src/audio/AudioEngine.ts` — Web Audio グラフ（各トラック `MediaElementSource -> GainNode -> masterGain -> destination`）、`AudioContext.currentTime` を基準にしたマスタークロック、各メディア要素の drift 補正、mute/solo のゲイン制御。
- `src/audio/useAudioEngine.ts` — エンジンを React に橋渡しする hook（構造状態は `useSyncExternalStore`、再生位置は rAF で別管理）。
- `src/components/` — `FileDrop` / `Transport` / `Timeline` / `TrackList`。
