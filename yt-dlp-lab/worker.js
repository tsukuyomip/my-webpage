// Pyodide と yt-dlp を抱えるワーカー。
//
// ここがワーカーなのは同期 XHR のため。yt-dlp のネットワーク API は同期で、
// 途中に await を挟む隙がない。同期 XHR はメインスレッドだと UI を固めるうえ
// responseType も指定できない（仕様が associated document を持つ場合に禁じている）が、
// ワーカーには document がないので arraybuffer 込みで正規に使える。

const PYODIDE_VERSION = "314.0.6";
const PYODIDE_CDN = `https://cdn.jsdelivr.net/pyodide/v${PYODIDE_VERSION}/full/`;

let pyodide = null;

const post = (type, payload) => self.postMessage({ type, ...payload });
const log = (line, level = "info") => post("log", { line, level });

// ---------------------------------------------------------------- 同期 fetch

// browser_net.py から呼ばれる。契約:
//   ydlSyncFetch(specJson) -> { meta: <JSON文字列>, body: Uint8Array | null }
// 名前が __ 始まりでないのは、Python 側のクラス本体で属性名がマングルされるため。
self.ydlSyncFetch = (specJson) => {
  const spec = JSON.parse(specJson);
  const xhr = new XMLHttpRequest();
  xhr.open(spec.method, spec.url, false); // 第3引数 false = 同期

  // 同期 XHR に responseType を許さないブラウザに備えて、生テキストで
  // バイト列を受け取る古典的な逃げ道を用意しておく。
  let binaryViaText = false;
  try {
    xhr.responseType = "arraybuffer";
  } catch {
    binaryViaText = true;
    xhr.overrideMimeType("text/plain; charset=x-user-defined");
  }

  if (spec.credentials) xhr.withCredentials = true;

  for (const [k, v] of Object.entries(spec.headers)) {
    // 禁止ヘッダは Python 側で落としてあるが、ブラウザによって禁止範囲が
    // 違うので、弾かれても全体を止めない。
    try { xhr.setRequestHeader(k, v); } catch { /* ブラウザが拒否したヘッダは諦める */ }
  }

  try {
    xhr.send(spec.body ? base64ToBytes(spec.body) : null);
  } catch (e) {
    // CORS 拒否・DNS 失敗・接続断はすべてここに来る。XHR は理由を教えて
    // くれないので、切り分けはページ側の環境チェックに任せる。
    return { meta: JSON.stringify({ error: String(e && e.message || e) }), body: null };
  }

  const headers = {};
  for (const line of (xhr.getAllResponseHeaders() || "").trim().split(/\r?\n/)) {
    const i = line.indexOf(":");
    if (i > 0) headers[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }

  let body;
  if (binaryViaText) {
    const s = xhr.responseText || "";
    body = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) body[i] = s.charCodeAt(i) & 0xff;
  } else {
    body = new Uint8Array(xhr.response || 0);
  }

  return {
    meta: JSON.stringify({
      status: xhr.status,
      // リダイレクト後の最終 URL。相対 URL の解決に効くので responseURL を優先する。
      url: xhr.responseURL || spec.url,
      headers,
    }),
    body,
  };
};

function base64ToBytes(b64) {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

// ------------------------------------------------------------------ 起動処理

async function boot({ ytdlpVersion, pyodideBase } = {}) {
  // ネットワークの届かない場所や、CDN を信用したくない場合に備えて
  // 配信元を差し替えられるようにしてある（?pyodide=... で指定）。
  const base = pyodideBase || PYODIDE_CDN;
  // Pyodide 314 以降は importScripts を受け付けない（モジュールワーカー必須）ので、
  // 動的 import で読む。呼び出し側も type:"module" でこのワーカーを起こすこと。
  log("Pyodide を読み込んでいます…");
  const { loadPyodide } = await import(base + "pyodide.mjs");
  pyodide = await loadPyodide({ indexURL: base });
  log(`Python ${pyodide.runPython("import sys; sys.version.split()[0]")} 起動`);

  await pyodide.loadPackage("micropip");
  // ytdlpVersion は "2026.8.19" のようなバージョンでも、wheel の URL でも受ける。
  // nightly を直接指したい場合や、PyPI に出ていく前に手元の wheel で試したい
  // 場合があるため。
  const spec = !ytdlpVersion ? "yt-dlp"
    : /:\/\/|\.whl$/.test(ytdlpVersion) ? ytdlpVersion
    : `yt-dlp==${ytdlpVersion}`;
  log(`yt-dlp を取得しています… (${spec})`);
  await pyodide.runPythonAsync(`
import micropip
await micropip.install(${JSON.stringify(spec)})
`);

  // ネットワーク層の差し替えはページ側に置いてある。yt-dlp を更新しても
  // ここだけ直せば済むようにファイルを分けている。
  const src = await (await fetch("py/browser_net.py?v=20260826a")).text();
  pyodide.FS.writeFile("/browser_net.py", src);

  const version = pyodide.runPython(`
import sys
sys.path.insert(0, "/")
import yt_dlp, browser_net
yt_dlp.version.__version__
`);
  log(`yt-dlp ${version} を読み込みました`);

  // with 文の中身は runPython の戻り値にならないので、最後を式にしておく
  const handlers = pyodide.runPython(`
import yt_dlp
_probe_ydl = yt_dlp.YoutubeDL({"quiet": True})
_handlers = ", ".join(sorted(_probe_ydl._request_director.handlers))
_probe_ydl.close()
_handlers
`);
  log(`ネットワークハンドラ: ${handlers}`);
  post("ready", { version, handlers });
}

// -------------------------------------------------------------- 抽出（情報のみ）

function extract(url) {
  pyodide.globals.set("_target_url", url);
  const json = pyodide.runPython(`
import json, yt_dlp

opts = {
    "quiet": True,
    "no_warnings": True,
    "skip_download": True,
    # ブラウザには外部プロセスがないので、yt-dlp が deno を探しに行かないようにする
    "js_runtimes": {},
}
with yt_dlp.YoutubeDL(opts) as ydl:
    info = ydl.extract_info(_target_url, download=False)
    # InfoDict には JSON にできないオブジェクトが混ざるので必ず通す
    info = ydl.sanitize_info(info)
json.dumps(info, ensure_ascii=False, default=str)
`);
  return JSON.parse(json);
}

self.onmessage = async (ev) => {
  const { type, payload } = ev.data;
  try {
    if (type === "boot") {
      await boot(payload);
    } else if (type === "extract") {
      log(`抽出中: ${payload.url}`);
      post("extracted", { info: extract(payload.url) });
    } else if (type === "probe") {
      // 拡張が入っているかどうかを、Python ではなく素の XHR で確かめる。
      // yt-dlp を通すと失敗理由が抽出エラーに埋もれてしまうため。
      const r = self.ydlSyncFetch(JSON.stringify({
        method: "GET", url: payload.url, headers: {}, body: null, credentials: false,
      }));
      post("probed", { meta: JSON.parse(r.meta) });
    }
  } catch (e) {
    post("error", { message: String(e && e.message || e) });
  }
};
