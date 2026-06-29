# 🎛️ Audio/Video Mixer Web App — 開発プラン

## コンテキスト（なぜ作るか）

複数の音源・動画（off-vocal / only-vocal / 単発SE）を **タイムライン上で開始位置を揃え**、
**リアルタイムに mute / solo / SE発声** を切り替えながら、**プレビューで何度も確認** できる Web アプリ。
PC・スマホ両対応。最終的には動画書き出し・プロジェクト保存まで対応したい。

現状リポジトリは静的サイト（`index.html` + `style.css`）のみで、再利用できる既存ロジックはなし
＝実質ゼロからの新規開発。

## 決定事項（技術的方針）

| 項目 | 採用 | 理由 |
|---|---|---|
| **スタック** | React + Vite + TypeScript | 複数トラックの状態管理・タイムライン UI が複雑。型安全で保守しやすく、静的ビルドして GitHub Pages 配信可。 |
| **配置** | サブパス `/mixer/` に新規追加 | 既存の個人ページを残したまま共存。Pages で両方配信。 |
| **MVP 範囲** | まず音声ミックス → 動画は段階的に | リスクの高い同期・書き出しを後回しにし、早く動くものを作る。 |
| **オーディオ基盤** | Web Audio API | mute = gain 0、solo = 他を gain 0、SE = AudioBufferSourceNode でワンショット。 |

## アーキテクチャの肝

- **マスタークロック**: Web Audio の `AudioContext.currentTime` を唯一の時間基準にする。各メディアはこれに同期。
- **オーディオグラフ**: 各トラック `MediaElementSource` → `GainNode` → master `GainNode` → `destination`。
- **動画同期の難所**: 複数 `<video>` は放置すると drift する。トランスポート時刻と各要素の `currentTime` 差を監視し、閾値超過で `playbackRate` 微調整 or 再シークして補正。
- **トラックオフセット**: 各トラックに開始オフセットを持たせ、タイムライン上でドラッグして開始位置を合わせる。
- **オートメーション（mute/solo/SE マーカー）**: トラックごとに時刻付きマーカーを保持。再生中に適用、一時停止中にビジュアル編集（追加 / 移動 / 削除）。
- **スマホ対応**: iOS 等の自動再生制限のため、ユーザー操作で AudioContext を起動。タッチでタイムライン操作。レスポンシブレイアウト。

## 実装フェーズ

### Phase 0 — 足場づくり
- `/mixer/` に Vite + React + TS をセットアップ。
- GitHub Pages 向けに base パス設定・静的ビルド。

### Phase 1 — MVP: オーディオエンジン + トランスポート
- 複数ファイル読込（ドラッグ&ドロップ / ファイル選択）
- Web Audio グラフ構築・master clock・play / pause / seek
- 各トラック mute / solo
- シークバー + プレイヘッドの基本タイムライン UI

### Phase 2 — タイムライン整列
- トラックごとのオフセット（クリップをドラッグして開始位置合わせ）
- クリップブロック表示

### Phase 3 — オートメーション (mute / solo / SE)
- 一時停止中のマーカー編集
- SE ワンショット発火
- 再生中のリアルタイム適用

### Phase 4 — 動画グリッドプレビュー（ストレッチ）
- グリッド / 縦横並びレイアウト
- mute / solo 時のグレーアウト（透過度は設定値化）

### Phase 5 — プロジェクト保存 / 再開（ストレッチ）
- タイムライン状態を JSON シリアライズ
- メディアは IndexedDB or File System Access API で保持

### Phase 6 — 動画書き出し（ストレッチ）
- Canvas 合成 + Web Audio destination stream を MediaRecorder で録画
- もしくは ffmpeg.wasm

## 検証方法

- 各フェーズで `npm run dev` のローカルプレビューを起動し、実ファイルで動作確認。
- 同期精度はサンプル音源＋メトロノーム動画で drift を目視 / 計測。
- スマホはレスポンシブ確認（ブラウザのデバイスエミュ＋実機）。
