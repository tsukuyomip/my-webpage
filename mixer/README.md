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
- Phase 2 以降は `docs/mixer-plan.md` を参照。

## アーキテクチャ概要

- `src/audio/AudioEngine.ts` — Web Audio グラフ（各トラック `MediaElementSource -> GainNode -> masterGain -> destination`）、`AudioContext.currentTime` を基準にしたマスタークロック、各メディア要素の drift 補正、mute/solo のゲイン制御。
- `src/audio/useAudioEngine.ts` — エンジンを React に橋渡しする hook（構造状態は `useSyncExternalStore`、再生位置は rAF で別管理）。
- `src/components/` — `FileDrop` / `Transport` / `Timeline` / `TrackList`。
