# yt-dlp lab

yt-dlp を**ブラウザの中だけで**動かす実験。サーバーは立てない。GitHub Pages に置いた
静的ページが Pyodide で Python を起動し、PyPI から yt-dlp を入れて、そのまま
`extract_info()` を呼ぶ。

## 何が動いていて、何が動かないのか

検証済み（Chromium 実機）:

- Pyodide (Python 3.14 / wasm) 上で yt-dlp 2026.08.19 が **extractor 1751 個ごと** import できる
- ネットワーク層を差し替えた状態で `extract_info()` が最後まで走り、フォーマット一覧が返る
- 拡張を入れると、CORS で塞がれていた別オリジンのサイトも抽出できる（入れないと失敗する）

未確認・未対応:

- **YouTube**。理由は下の「JS チャレンジ」を参照
- プリフライトを伴うリクエスト（`Content-Type: application/json` の POST や独自ヘッダ）。
  拡張は応答にヘッダを足すだけなので、サーバーが `OPTIONS` 自体を拒む相手には効かない
- ダウンロードと ffmpeg による結合。今は情報を取るところまで

## 仕組み

```
GitHub Pages（静的ファイルのみ）
├─ index.html / app.js …… 画面
└─ worker.js ……………… Pyodide を抱えるモジュールワーカー
   ├─ micropip install yt-dlp  ← PyPI から直接
   └─ py/browser_net.py ……… yt-dlp のネットワーク層の差し替え
拡張機能（30行・ロジックなし）
└─ 応答に CORS 許可ヘッダを足すだけ
```

### なぜワーカーなのか

yt-dlp のネットワーク API は同期で、途中に `await` を挟む隙がない。ブラウザで同期的に
HTTP を叩く手段は同期 XHR しかないが、これはメインスレッドだと UI を固めるうえ
`responseType` も指定できない（仕様が「associated document を持つ場合」を禁じている）。
ワーカーには document がないので、`arraybuffer` 込みで正規に使える。

### なぜ差し替えが要るのか

yt-dlp の通信は urllib / requests / curl_cffi のいずれかが担当していて、どれもソケットを
掴む。wasm にソケットはないので、そのままでは全滅する。yt-dlp 側に `register_rh` という
公開 API があるので、XHR に丸投げするハンドラを 1 枚被せている（`py/browser_net.py`）。
`register_preference` で優先度 1000 を与え、必ず失敗する Urllib より確実に上に置く。

### JS チャレンジ（YouTube が動かない理由）

YouTube の n/sig 署名解読には JS の実行が要る。yt-dlp はこれを外部の deno / node /
bun / quickjs を**子プロセスとして起動して**解いており、ブラウザには子プロセスがない。

ただし yt-dlp には `yt_dlp.extractor.youtube.jsc.provider` という公開のプロバイダ
フレームワークがあり、`register_provider` で解決手段を差し込める。ブラウザは JS エンジン
そのものなので、ここにブラウザ自身を挿すのが筋の良い次の一手になる。未着手。

## 使い方

1. `chrome://extensions` を開き、デベロッパーモードを ON
2. 「パッケージ化されていない拡張機能を読み込む」で `yt-dlp-lab/extension/` を選ぶ
3. ページを開き「起動する」。初回は Pyodide と yt-dlp の取得で数十秒かかる
4. URL を入れて「情報を取得」

拡張なしでも、CORS を許可しているサイトなら動く。

### 開発用のクエリパラメータ

| パラメータ | 用途 |
|---|---|
| `?pyodide=/pyo/` | Pyodide の配信元を差し替える（CDN が使えない環境やオフライン検証用） |
| `?ytdlp=2026.8.19` | yt-dlp のバージョンを固定する |
| `?ytdlp=/pyo/yt_dlp-....whl` | wheel を直接指定する（nightly や手元ビルドの検証用） |

## 拡張について

`extension/rules.json` は `declarativeNetRequest` のルール 2 本だけで、コードは 1 行もない。

- ルール1: `tsukuyomip.github.io` から出た XHR の応答に、このオリジン宛の許可ヘッダを足す。
  オリジンを厳密に指定しているので `Access-Control-Allow-Credentials: true` が使える
- ルール2: `localhost` から出た XHR 用。ポートを問わず通したいので `Access-Control-Allow-Origin: *`
  にしてある。仕様上 `*` と Credentials は併用できないため、こちらは Cookie を送れない

**公開先のオリジンを変える場合はルール1の値を書き換えること。** ここが一致していないと
拡張は入っているのに何も通らない、という分かりにくい状態になる。

### Cookie を送るかどうか

`py/browser_net.py` の `SEND_CREDENTIALS` は既定で `False`。`True` にするとブラウザに
ログイン済みのセッションがそのまま使われ、会員向けページも扱えるようになる代わりに、
自分のアカウントで自動アクセスしていることが相手から見える状態になる。

## 制約

- Pyodide は wasm32 なのでアドレス空間が 32bit。数百 MB を超える動画をメモリに載せるのは
  無理があり、ダウンロードを実装するときは OPFS へ流し込む必要がある
- ブラウザが送信を許さないヘッダ（`User-Agent`, `Referer`, `Origin`, `Cookie` など）は
  `py/browser_net.py` の `FORBIDDEN_HEADERS` で落としている。これらはブラウザ自身の値が
  使われるため、特定の UA を要求する extractor は期待通りに動かない
- 本文はブラウザが展開済みで返すので、`Content-Encoding` と `Content-Length` は
  応答ヘッダから外している。残すと yt-dlp が「まだ圧縮されている」と誤解する
