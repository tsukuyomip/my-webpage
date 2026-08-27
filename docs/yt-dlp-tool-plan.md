# yt-dlp をブラウザだけで動かす計画

## 前提と結論

GitHub Pages は静的ファイルしか返せないので、サーバー側で yt-dlp を動かす道はない。
一方で yt-dlp は**純 Python**（wheel が `py3-none-any`）なので、Pyodide に載せること
自体は成立する。塞がっているのはネットワークだけ。

そこで「ロジックは全部 Pages 上に置き、拡張機能には CORS を外す役だけをやらせる」構成を採る。
拡張は一度入れたら触らず、機能追加は `git push` だけで届く。

## 検証済みの事実（2026-08-26 / Chromium 実機）

| 確かめたこと | 結果 |
|---|---|
| Pyodide 314.0.6 = Python 3.14.2 で yt-dlp 2026.08.19 を import | 成功。extractor 1751 個 |
| C 拡張への依存 | なし（wheel が `py3-none-any`） |
| `ssl` / `socket` / `sqlite3` / `http.client` などの stdlib | すべて存在 |
| `register_rh` で差し替えたハンドラが選ばれるか | `Browser, Urllib` の 2 つが登録され、Browser が優先される |
| 差し替えた層で `extract_info()` が通るか | 成功（html5 extractor、フォーマット取得まで） |
| 同期 XHR + `responseType="arraybuffer"` をワーカーで使えるか | 使える |
| 拡張なしで別オリジンを読めるか | 読めない（`Failed to fetch`） |
| 拡張ありで別オリジンを読めるか | 読める（200） |
| 拡張ありで別オリジンのページを抽出できるか | 成功 |

つまり**土台は通っている**。残りは対象サイトごとの詰め。

## 分かっている壁

### 1. プリフライト

拡張は「応答にヘッダを足す」ことしかできない。`Content-Type: application/json` の POST や
独自ヘッダを伴うリクエストはブラウザが先に `OPTIONS` を投げるため、サーバーが `OPTIONS`
自体を拒む相手には届かない。YouTube の `youtubei/v1/player` がまさにこれに当たる。

回避するなら、拡張の Service Worker 側で `fetch` を代行させる構成に変える必要がある
（拡張オリジンからの fetch には CORS がかからない）。ただし yt-dlp 側が同期 API なので、
ワーカーから `Atomics.wait` + SharedArrayBuffer で待つ橋が要る。SharedArrayBuffer には
COOP/COEP が必要で、GitHub Pages はヘッダを設定できないため `coi-serviceworker` を噛ませる
ことになる。ffmpeg.wasm のマルチスレッド版も同じ前提を要求するので、どのみち通る道ではある。

### 2. 禁止ヘッダ

XHR は `User-Agent` / `Referer` / `Origin` / `Cookie` などの指定を黙って無視する。
これらはブラウザ自身の値になるため、特定の UA を要求する extractor は期待通りに動かない。
上の「拡張側 fetch」構成に移れば、`declarativeNetRequest` の request header 書き換えで
ある程度は手当てできる。

### 3. JS チャレンジ

YouTube の n/sig 解読には JS 実行が要る。yt-dlp は deno / node / bun / quickjs を
**子プロセスとして起動**して解いており、ブラウザには子プロセスがない。

ただし `yt_dlp.extractor.youtube.jsc.provider` が公開のプロバイダフレームワークになっていて、
`register_provider` で差し込める。ブラウザは JS エンジンそのものなので、ここに自分自身を
挿すのが正攻法。yt-dlp 側が `Popen` を前提にしていない設計なのは追い風。

### 4. メモリ

Pyodide は wasm32 でアドレス空間が 32bit。動画をまるごとメモリに載せる作りにすると
数百 MB で頭を打つ。ダウンロードを実装するときは、最初から OPFS へストリームで
流し込む前提で書く。

## 段階

- **第1段（完了）** `yt-dlp-lab/`。情報取得まで。CORS ブリッジ拡張、ネットワーク層の差し替え、
  環境チェック、フォーマット一覧
- **第2段** ダウンロード。OPFS へストリーム保存 → File System Access API で書き出し。
  `Range` は禁止ヘッダではないので分割取得はそのまま使える
- **第3段** ffmpeg.wasm。映像+音声の結合、音声抽出。`coi-serviceworker` で COOP/COEP を回避
- **第4段** 拡張側 fetch + SharedArrayBuffer 橋。プリフライトと禁止ヘッダの問題を根本から外す
- **第5段** JS チャレンジプロバイダ。ブラウザの JS エンジンを yt-dlp に貸して YouTube に対応

第2段と第3段は第4段を待たずに進められる。第5段は第4段が前提。

## やらないと決めたこと

- **GitHub Actions をバックエンドにする**。技術的には動くが、Actions は
  「リポジトリのソフトウェアプロジェクトの production / testing / deployment / publication に
  無関係な活動」に使ってはならないと利用規約に明記されている。加えてランナーはデータセンター
  IP で、YouTube の bot 判定が最も厳しく当たる帯域でもある
- **公開の CORS プロキシに頼る**。通信内容を第三者に預けることになるうえ、動かなくなる日が来る
