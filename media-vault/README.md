# 📦 Media Vault

画像・動画・音声をブラウザ内（IndexedDB）に保存し、テキストで検索できる Web アプリ。

- **画像** → Tesseract.js による文字認識（OCR、日本語＋英語）
- **動画・音声** → Whisper（transformers.js / ONNX Runtime Web）によるタイムスタンプ付き文字起こし
- **検索** → ファイル名＋抽出テキストの部分一致（NFKC 正規化・大文字小文字無視・空白無視のフォールバック付き）。動画は一致した箇所の時刻から再生ジャンプ可能
- 認識結果は手動で編集・再認識も可能

## プライバシー

ファイルも抽出テキストもすべて端末のブラウザ内にのみ保存され、外部へは送信されません。
初回利用時のみ認識エンジンをダウンロードします:

- OCR（Tesseract worker / core / 言語データ）: このサイトから配信（約 25MB、自前ホスト）
- Whisper モデル: Hugging Face Hub から取得（tiny 約40MB / base 約60MB / small 約190MB、ブラウザにキャッシュされます）

## 開発

```bash
npm install
npm run dev      # 開発サーバー
npm run build    # 型チェック + 本番ビルド（dist/）
```

`scripts/copy-assets.mjs` が node_modules から Tesseract / ONNX Runtime の
実行資材を `public/vendor/` にコピーします（`dev` / `build` で自動実行）。

GitHub Pages には `/my-webpage/media-vault/` 配下としてデプロイされます
（`.github/workflows/deploy-pages.yml` 参照）。
