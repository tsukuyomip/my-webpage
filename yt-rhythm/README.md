# 🎯 YT Rhythm

YouTube の動画の上にノーツを置いて遊ぶタップ音ゲー。
譜面はブラウザ上で作れて、JSON ファイルとして書き出し・読み込みできる。

- **プレイモード**: 譜面 JSON を読み込んで遊ぶ。判定は PERFECT / GREAT / GOOD / MISS。
- **クリエイトモード**: 動画を指定してノーツを配置・移動・削除し、タイミングを微調整して書き出す。

`/my-webpage/yt-rhythm/` に配信される（GitHub Pages）。

## 開発

```sh
npm install
npm run dev      # 開発サーバ
npm run build    # tsc --noEmit && vite build
```

依存は Vite と TypeScript だけ。UI は素の DOM、ゲーム描画は Canvas 2D。

## 構成

| パス | 役割 |
|---|---|
| `src/core/clock.ts` | YouTube の粗い `getCurrentTime()` を補間する時計。判定と描画の唯一の時間基準。 |
| `src/core/chart.ts` | 譜面 JSON の読み書き。未知の種別・バージョンは読み飛ばす。 |
| `src/core/judge.ts` | 判定幅とスコア計算。 |
| `src/core/geometry.ts` | 正規化座標 ↔ ピクセルの変換、ノーツ半径。 |
| `src/yt/player.ts` | IFrame Player API のラッパと URL → 動画 ID 抽出。 |
| `src/render/` | ノーツ描画・HUD・エフェクト。 |
| `src/ui/stage.ts` | 動画とキャンバスを重ねた領域。ポインタ入力の受け口。 |
| `src/ui/timeline.ts` | 時刻軸のミニビュー。ノーツを横ドラッグしてタイミング調整。 |
| `src/modes/play.ts` | プレイモード。 |
| `src/modes/edit.ts` | クリエイトモード。 |

## 譜面フォーマット (formatVersion 1)

```jsonc
{
  "formatVersion": 1,
  "meta": {
    "title": "曲名",
    "videoId": "dQw4w9WgXcQ",
    "author": "作った人",       // 任意
    "difficulty": "Normal"      // 任意
  },
  "timing": {
    "offsetMs": 0,              // 判定時刻 = 動画時刻 - offsetMs
    "bpm": 120,                 // 任意。エディタのスナップ用
    "beatOffsetMs": 0,          // 任意
    "division": 2               // 任意。1=4分, 2=8分, 4=16分
  },
  "notes": [
    { "id": "n1", "type": "tap", "time": 12.345, "x": 0.5, "y": 0.4 }
  ]
}
```

- `time` は秒。`x` / `y` は動画表示領域を 0..1 に正規化した座標なので、画面サイズが変わっても崩れない。
- `fx` を書くとノーツごとにヒットエフェクトを変えられる（現在は `ripple` / `burst`）。
- 読み込み側は知らない `type` やフィールドを読み飛ばすので、将来種別が増えても古い譜面はそのまま読める。

## 設計メモ

### 時刻の精度

`player.getCurrentTime()` は更新が粗く、そのままでは判定に使えない。
`MediaClock` は「値が変わった瞬間だけをアンカーにして `performance.now()` で外挿し、
ズレは 1 サンプルあたり 15% ずつ吸収する」方式で滑らかな時刻を作る。
0.3 秒以上ずれたらシーク／バッファ復帰とみなしてアンカーを取り直す。

### 判定オフセット

端末やブラウザによって音の遅れが違うので、設定に **判定オフセット** がある。
「遅い」と判定されがちなら + 方向、「早い」なら − 方向。
譜面側の `timing.offsetMs` と合算して使われる。

判定時刻（= 譜面時刻）は常に `動画時刻 - オフセット` で、
エディタの配置・再生・プレイの判定すべてが同じ基準を使う。

### 拡張ポイント

- **ノーツ種別**: `core/types.ts` の `Note` にユニオンを足し、`render/renderer.ts` と
  `modes/play.ts` の判定に分岐を足す。読み込み側は既に未知種別を無視する作りになっている。
- **エフェクト**: `render/effects.ts` の `registerEffect(name, factory)` に足すだけ。
  譜面の `note.fx` で指定できる。

## 制約

- 埋め込み再生が許可されていない動画、年齢制限つきの動画は再生できない。
- iframe は cross-origin なので音声波形は取得できない。エディタは波形の代わりに
  BPM のビートグリッドと「再生しながら置く」ワークフローで合わせる。
- モバイルは初回再生にユーザー操作が必要（スタートボタンがそれを兼ねている）。
